import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, type Actor } from "../lib/access";
import { getMemberships, isStaffRole, isSuperAdmin } from "../lib/auth";
import { appError } from "../lib/errors";
import { driveConfigured, folderUrl } from "../lib/google";
import { optionalText, requireText } from "../lib/input";
import { materialsSourceValidator, materialsStatusValidator } from "../lib/validators";
import { displayName, logAudit } from "./audit";

/**
 * Course materials, week by week. A week is either a folder Kalami creates in
 * the lecturer's Google Drive (they upload files there; Google stores and
 * serves them) or a plain link to anywhere. Publishing a Drive week shares its
 * folder as "anyone with the link can view"; unpublishing takes that back.
 * The course folder itself is never shared, so unpublished weeks stay private.
 *
 * Drive calls run in actions (drive.ts) scheduled from these mutations; the
 * `syncing` field says one is in flight, so a second click waits for it.
 */

const MAX_WEEKS = 100;
/** A Drive job that hasn't reported back by then crashed; the lecturer may retry. */
export const STALE_SYNC_MS = 2 * 60 * 1000;

export const staffMaterialValidator = v.object({
  _id: v.id("materials"),
  order: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  source: materialsSourceValidator,
  status: materialsStatusValidator,
  /** The link, or the Drive folder once it exists. */
  url: v.optional(v.string()),
  /** Drive: whether students can open the folder right now. */
  shared: v.boolean(),
  syncing: v.optional(v.union(v.literal("folder"), v.literal("share"), v.literal("unshare"))),
  /** True when the job above stopped reporting back and may be retried. */
  stale: v.boolean(),
  driveError: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
});

export const courseMaterialsValidator = v.object({
  canEdit: v.boolean(),
  /** Whether this Kalami server can talk to Google Drive at all. */
  driveAvailable: v.boolean(),
  drive: v.union(
    v.null(),
    v.object({
      ownerName: v.string(),
      /** Only the owner's Google account is ever used for this course. */
      mine: v.boolean(),
      /** The owner left (or the viewer is the super admin): the viewer may move it to their own Drive. */
      canTakeOver: v.boolean(),
      folderUrl: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  ),
  weeks: v.array(staffMaterialValidator),
});

export const studentMaterialValidator = v.object({
  _id: v.id("materials"),
  title: v.string(),
  description: v.optional(v.string()),
  source: materialsSourceValidator,
  url: v.string(),
  /** The link's host, so students see where they're going ("drive.google.com"). */
  host: v.string(),
});

// --- Reading ----------------------------------------------------------------------------

async function weeksOf(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("materials")
    .withIndex("by_courseId_and_order", (q) => q.eq("courseId", courseId))
    .take(MAX_WEEKS + 1);
}

export async function driveOf(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("courseDrive")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .unique();
}

function isStale(row: Doc<"materials">, now: number): boolean {
  return row.syncing !== undefined && row.syncingSince !== undefined && now - row.syncingSince > STALE_SYNC_MS;
}

/**
 * Staff view. `now` comes from the client's clock only to flag stuck jobs;
 * nothing about access depends on it.
 */
export async function listCourseMaterials(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">, now: number) {
  const access = await courseAccess(ctx, actor, courseId);
  const drive = await driveOf(ctx, courseId);
  const weeks = (await weeksOf(ctx, courseId)).map((row) => ({
    _id: row._id,
    order: row.order,
    title: row.title,
    description: row.description,
    source: row.source,
    status: row.status,
    url: row.source === "link" ? row.url : row.folderId ? folderUrl(row.folderId) : undefined,
    shared: row.permissionId !== undefined,
    syncing: row.syncing,
    stale: isStale(row, now),
    driveError: row.driveError,
    publishedAt: row.publishedAt,
  }));
  return {
    canEdit: access.canEdit && access.course.status !== "archived",
    driveAvailable: driveConfigured(),
    drive:
      drive === null
        ? null
        : {
            ownerName: displayName(await ctx.db.get("users", drive.ownerId)),
            mine: drive.ownerId === actor.user._id,
            canTakeOver:
              access.canEdit && drive.ownerId !== actor.user._id && (await mayTakeOver(ctx, actor, drive.ownerId)),
            folderUrl: drive.folderId ? folderUrl(drive.folderId) : undefined,
            error: drive.error,
          },
    weeks,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** What students of the course see: published weeks they can actually open. */
export async function publishedMaterials(ctx: QueryCtx, courseId: Id<"courses">) {
  const out = [];
  for (const row of await weeksOf(ctx, courseId)) {
    if (row.status !== "published") continue;
    const url =
      row.source === "link" ? row.url : row.folderId && row.permissionId ? folderUrl(row.folderId) : undefined;
    if (url === undefined) continue;
    out.push({ _id: row._id, title: row.title, description: row.description, source: row.source, url, host: hostOf(url) });
  }
  return out;
}

// --- Changing ---------------------------------------------------------------------------

/** Only https links, with a real host, no credentials in them. */
export function requireHttpsUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw appError("INVALID_INPUT", "Enter a full link that starts with https://");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username !== "" || url.password !== "") {
    throw appError("INVALID_INPUT", "Enter a full link that starts with https://");
  }
  if (url.href.length > 2000) {
    throw appError("INVALID_INPUT", "That link is too long.");
  }
  return url.href;
}

async function requireMaterial(ctx: QueryCtx, actor: Actor, materialId: Id<"materials">) {
  const row = await ctx.db.get("materials", materialId);
  if (row === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  const access = await requireCourseContentEditor(ctx, actor, row.courseId);
  return { row, course: access.course };
}

async function nextOrder(ctx: QueryCtx, courseId: Id<"courses">) {
  const weeks = await weeksOf(ctx, courseId);
  if (weeks.length >= MAX_WEEKS) {
    throw appError("CONFLICT", `A course can have at most ${MAX_WEEKS} weeks of materials.`);
  }
  return weeks.length === 0 ? 1 : weeks[weeks.length - 1].order + 1;
}

/** Drive work on a course uses one person's Drive: whoever set it up. Nobody else may spend it. */
async function requireDriveOwner(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">) {
  const drive = await driveOf(ctx, courseId);
  if (drive !== null && drive.ownerId !== actor.user._id) {
    const owner = displayName(await ctx.db.get("users", drive.ownerId));
    throw appError("FORBIDDEN", `This course's materials live in ${owner}'s Google Drive. Only they can change its folders.`);
  }
  return drive;
}

function requireIdle(row: Doc<"materials">, now: number) {
  if (row.syncing !== undefined && !isStale(row, now)) {
    throw appError("CONFLICT", "Google Drive is still working on this week. Give it a moment.");
  }
}

export async function addLinkWeek(
  ctx: MutationCtx,
  actor: Actor,
  args: { courseId: Id<"courses">; title: string; description?: string; url: string },
) {
  const { course } = await requireCourseContentEditor(ctx, actor, args.courseId);
  const title = requireText(args.title, "Title", 120);
  const materialId = await ctx.db.insert("materials", {
    courseId: args.courseId,
    order: await nextOrder(ctx, args.courseId),
    title,
    description: optionalText(args.description, "Description", 1000),
    source: "link",
    status: "draft",
    url: requireHttpsUrl(args.url),
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: Date.now(),
  });
  await logAudit(ctx, actor, {
    action: "materials.addLink",
    targetTable: "materials",
    targetId: materialId,
    courseId: args.courseId,
    summary: `Added the materials link "${title}" to "${course.title}"`,
  });
  return materialId;
}

/** A new week whose folder Kalami creates in the actor's Drive (the course folder too, the first time). */
export async function addDriveWeek(
  ctx: MutationCtx,
  actor: Actor,
  args: { courseId: Id<"courses">; title: string; description?: string },
) {
  const { course } = await requireCourseContentEditor(ctx, actor, args.courseId);
  if (!driveConfigured()) {
    throw appError("CONFLICT", "Google Drive isn't set up on this Kalami server yet. Add a link instead.");
  }
  const title = requireText(args.title, "Title", 120);
  const now = Date.now();
  const drive = await requireDriveOwner(ctx, actor, args.courseId);
  if (drive === null) {
    await ctx.db.insert("courseDrive", { courseId: args.courseId, ownerId: actor.user._id, updatedAt: now });
  }
  const materialId = await ctx.db.insert("materials", {
    courseId: args.courseId,
    order: await nextOrder(ctx, args.courseId),
    title,
    description: optionalText(args.description, "Description", 1000),
    source: "drive",
    status: "draft",
    syncing: "folder",
    syncingSince: now,
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { materialId, attempt: 0 });
  await logAudit(ctx, actor, {
    action: "materials.addDrive",
    targetTable: "materials",
    targetId: materialId,
    courseId: args.courseId,
    summary: `Added the Drive week "${title}" to "${course.title}"`,
  });
  return materialId;
}

export async function updateWeek(
  ctx: MutationCtx,
  actor: Actor,
  materialId: Id<"materials">,
  patch: { title?: string; description?: string; url?: string },
) {
  const { row } = await requireMaterial(ctx, actor, materialId);
  const changes: Partial<Doc<"materials">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", 120);
  if (patch.description !== undefined) changes.description = optionalText(patch.description, "Description", 1000);
  if (patch.url !== undefined) {
    if (row.source !== "link") {
      throw appError("INVALID_INPUT", "A Drive week's folder can't be swapped for a link.");
    }
    changes.url = requireHttpsUrl(patch.url);
  }
  await ctx.db.patch("materials", materialId, { ...changes, updatedAt: Date.now() });
}

/** Swaps the week with its neighbour above or below. */
export async function moveWeek(ctx: MutationCtx, actor: Actor, materialId: Id<"materials">, direction: "up" | "down") {
  const { row } = await requireMaterial(ctx, actor, materialId);
  const weeks = await weeksOf(ctx, row.courseId);
  const index = weeks.findIndex((w) => w._id === materialId);
  const other = weeks[direction === "up" ? index - 1 : index + 1];
  if (other === undefined) {
    return;
  }
  await ctx.db.patch("materials", row._id, { order: other.order });
  await ctx.db.patch("materials", other._id, { order: row.order });
}

/**
 * Students see a link week at once. A Drive week first gets its folder shared
 * by link; students see it when that's done (the page shows "Sharing…").
 */
export async function publishWeek(ctx: MutationCtx, actor: Actor, materialId: Id<"materials">) {
  const { row, course } = await requireMaterial(ctx, actor, materialId);
  const now = Date.now();
  requireIdle(row, now);
  if (row.source === "drive") {
    await requireDriveOwner(ctx, actor, row.courseId);
    if (row.folderId === undefined) {
      throw appError("CONFLICT", "This week's folder doesn't exist yet. Retry creating it first.");
    }
  }
  const sharing = row.source === "drive" && row.permissionId === undefined;
  await ctx.db.patch("materials", materialId, {
    status: "published",
    publishedAt: row.publishedAt ?? now,
    driveError: undefined,
    syncing: sharing ? "share" : undefined,
    syncingSince: sharing ? now : undefined,
    updatedAt: now,
  });
  if (sharing) {
    await ctx.scheduler.runAfter(0, internal.drive.shareWeek, { materialId, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "materials.publish",
    targetTable: "materials",
    targetId: materialId,
    courseId: row.courseId,
    summary: `Published the materials "${row.title}" in "${course.title}"`,
  });
}

/**
 * Hides the week from students and, for Drive, takes the link sharing off the
 * folder. Any course editor may do this: it only ever closes access.
 */
export async function unpublishWeek(ctx: MutationCtx, actor: Actor, materialId: Id<"materials">) {
  const { row, course } = await requireMaterial(ctx, actor, materialId);
  const now = Date.now();
  requireIdle(row, now);
  const unsharing = row.source === "drive" && row.permissionId !== undefined;
  await ctx.db.patch("materials", materialId, {
    status: "draft",
    driveError: undefined,
    syncing: unsharing ? "unshare" : undefined,
    syncingSince: unsharing ? now : undefined,
    updatedAt: now,
  });
  if (unsharing) {
    await ctx.scheduler.runAfter(0, internal.drive.unshareWeek, { materialId, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "materials.unpublish",
    targetTable: "materials",
    targetId: materialId,
    courseId: row.courseId,
    summary: `Hid the materials "${row.title}" in "${course.title}"`,
  });
}

/** Removes the week from Kalami. The Drive folder and its files stay in the lecturer's Drive. */
export async function removeWeek(ctx: MutationCtx, actor: Actor, materialId: Id<"materials">) {
  const { row, course } = await requireMaterial(ctx, actor, materialId);
  requireIdle(row, Date.now());
  if (row.status === "published" || row.permissionId !== undefined) {
    throw appError("CONFLICT", "Unpublish this week first, so its folder stops being shared.");
  }
  await ctx.db.delete("materials", materialId);
  await logAudit(ctx, actor, {
    action: "materials.remove",
    targetTable: "materials",
    targetId: materialId,
    courseId: row.courseId,
    summary: `Removed the materials "${row.title}" from "${course.title}"`,
  });
}

/** Runs again whatever Drive step failed or got stuck: the folder, sharing, or unsharing. */
export async function retryWeek(ctx: MutationCtx, actor: Actor, materialId: Id<"materials">) {
  const { row } = await requireMaterial(ctx, actor, materialId);
  const now = Date.now();
  requireIdle(row, now);
  if (row.source !== "drive") {
    return;
  }
  let job: "folder" | "share" | "unshare" | null = null;
  if (row.folderId === undefined) job = "folder";
  else if (row.status === "published" && row.permissionId === undefined) job = "share";
  else if (row.status === "draft" && row.permissionId !== undefined) job = "unshare";
  if (job === null) {
    await ctx.db.patch("materials", materialId, { driveError: undefined, syncing: undefined, syncingSince: undefined });
    return;
  }
  if (job !== "unshare") {
    await requireDriveOwner(ctx, actor, row.courseId);
  }
  await ctx.db.patch("materials", materialId, { syncing: job, syncingSince: now, driveError: undefined });
  if (job === "folder") {
    await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { materialId, attempt: 0 });
  } else if (job === "share") {
    await ctx.scheduler.runAfter(0, internal.drive.shareWeek, { materialId, attempt: 0 });
  } else {
    await ctx.scheduler.runAfter(0, internal.drive.unshareWeek, { materialId, attempt: 0 });
  }
}

/** Whether the course's Drive may move away from its owner: they lost their account or role, or the super admin says so. */
async function mayTakeOver(ctx: QueryCtx, actor: Actor, ownerId: Id<"users">) {
  if (isSuperAdmin(actor.memberships)) {
    return true;
  }
  const owner = await ctx.db.get("users", ownerId);
  if (owner === null || owner.deletedAt !== undefined) {
    return true;
  }
  return !(await getMemberships(ctx, owner._id)).some((m) => isStaffRole(m.role));
}

/**
 * Moves a course's materials to the actor's own Drive when its owner can't
 * continue. Kalami forgets the old folders (they stay in the old owner's Drive;
 * folders shared there stay shared, since nobody can reach that Drive any
 * more), every Drive week goes back to draft, and new folders get created in
 * the actor's Drive. Link weeks are untouched.
 */
export async function takeOverDrive(ctx: MutationCtx, actor: Actor, courseId: Id<"courses">) {
  const { course } = await requireCourseContentEditor(ctx, actor, courseId);
  const drive = await driveOf(ctx, courseId);
  if (drive === null || drive.ownerId === actor.user._id) {
    return;
  }
  if (!(await mayTakeOver(ctx, actor, drive.ownerId))) {
    throw appError("FORBIDDEN", "The course's Drive owner is still active. Ask them, or the platform admin.");
  }
  if (!driveConfigured()) {
    throw appError("CONFLICT", "Google Drive isn't set up on this Kalami server yet.");
  }
  const previous = displayName(await ctx.db.get("users", drive.ownerId));
  const now = Date.now();
  await ctx.db.patch("courseDrive", drive._id, {
    ownerId: actor.user._id,
    folderId: undefined,
    creatingSince: undefined,
    error: undefined,
    updatedAt: now,
  });
  for (const week of await weeksOf(ctx, courseId)) {
    if (week.source !== "drive") continue;
    await ctx.db.patch("materials", week._id, {
      status: "draft",
      folderId: undefined,
      permissionId: undefined,
      syncing: "folder",
      syncingSince: now,
      driveError: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { materialId: week._id, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "materials.takeOverDrive",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Moved the materials of "${course.title}" from ${previous}'s Google Drive to their own`,
  });
}
