import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, type Actor } from "../lib/access";
import { getMemberships, isStaffRole, isSuperAdmin } from "../lib/auth";
import { appError } from "../lib/errors";
import { driveConfigured, folderUrl } from "../lib/google";
import { optionalText, requireText } from "../lib/input";
import { type WeekLink } from "../lib/validators";
import { requireAssessmentAccess, toAssessment } from "./assessments";
import { displayName, logAudit } from "./audit";

/**
 * The course outline: weeks. A week ("Week 1", or any title: "Unit 2 · Forms")
 * holds lessons written in Kalami (model/lessons.ts), materials (one folder
 * in the course's Google Drive and any number of links), and the tasks and
 * quizzes placed in it. Midterms and finals sit outside weeks, in the course's
 * Exams section.
 *
 * Students see a week once it's published: its published lessons, its links,
 * and its Drive folder once sharing finished ("anyone with the link can
 * view"). The course folder itself is never shared, so draft weeks stay
 * private. Drive calls run in actions (drive.ts) scheduled from here; the
 * `syncing` field says one is in flight, so a second click waits for it.
 *
 * Agents (MCP) may only change draft weeks; publishing stays a person's click.
 */

export const MAX_WEEKS = 60;
const MAX_LINKS = 20;
/** A Drive job that hasn't reported back by then crashed; the lecturer may retry. */
export const STALE_SYNC_MS = 2 * 60 * 1000;

// --- Reading ----------------------------------------------------------------------------

export async function weeksOf(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("weeks")
    .withIndex("by_courseId_and_order", (q) => q.eq("courseId", courseId))
    .take(MAX_WEEKS + 1);
}

export async function lessonsOf(ctx: QueryCtx, weekId: Id<"weeks">) {
  return await ctx.db
    .query("lessons")
    .withIndex("by_weekId_and_order", (q) => q.eq("weekId", weekId))
    .take(100);
}

export async function driveOf(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("courseDrive")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .unique();
}

function isStale(row: Doc<"weeks">, now: number): boolean {
  return row.syncing !== undefined && row.syncingSince !== undefined && now - row.syncingSince > STALE_SYNC_MS;
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
 * The whole outline for the staff app and agents. `now` comes from the
 * client's clock only to flag stuck Drive jobs; nothing about access depends on it.
 */
export async function getOutline(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">, now: number) {
  const access = await courseAccess(ctx, actor, courseId);
  const assessments = (
    await ctx.db
      .query("assessments")
      .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
      .take(500)
  ).sort((a, b) => a._creationTime - b._creationTime);
  const weeks = await weeksOf(ctx, courseId);
  const weekIds = new Set(weeks.map((w) => w._id));
  const outlineWeeks = [];
  for (const week of weeks) {
    const lessons = await lessonsOf(ctx, week._id);
    outlineWeeks.push({
      _id: week._id,
      order: week.order,
      title: week.title,
      description: week.description,
      status: week.status,
      publishedAt: week.publishedAt,
      links: week.links,
      drive:
        week.folderId === undefined && week.syncing === undefined && week.driveError === undefined
          ? null
          : {
              url: week.folderId ? folderUrl(week.folderId) : undefined,
              shared: week.permissionId !== undefined,
              syncing: week.syncing,
              stale: isStale(week, now),
              error: week.driveError,
            },
      lessons: lessons.map((lesson) => ({
        _id: lesson._id,
        title: lesson.title,
        status: lesson.status,
        blockCount: lesson.blocks.length,
        createdVia: lesson.createdVia,
        updatedAt: lesson.updatedAt,
      })),
      assessments: assessments.filter((a) => a.weekId === week._id && isWeekKind(a)).map(toAssessment),
    });
  }
  const drive = await driveOf(ctx, courseId);
  return {
    courseId,
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
          },
    weeks: outlineWeeks,
    exams: assessments.filter((a) => !isWeekKind(a)).map(toAssessment),
    unplaced: assessments
      .filter((a) => isWeekKind(a) && (a.weekId === undefined || !weekIds.has(a.weekId)))
      .map(toAssessment),
  };
}

/** Tasks and quizzes live in weeks; midterms and finals in the Exams section. */
export function isWeekKind(assessment: Pick<Doc<"assessments">, "kind">): boolean {
  return assessment.kind === "task" || assessment.kind === "quiz";
}

// --- Rules ------------------------------------------------------------------------------

/** The week, if the actor may change the course's content. Agents only touch draft weeks. */
async function requireWeek(ctx: QueryCtx, actor: Actor, weekId: Id<"weeks">, purpose: "edit" | "publish" = "edit") {
  const week = await ctx.db.get("weeks", weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, week.courseId);
  requireReadingIdle(week);
  if (actor.via === "mcp" && (purpose === "publish" || week.status !== "draft")) {
    throw appError(
      "CONFLICT",
      purpose === "publish"
        ? "Only the lecturer can publish or unpublish a week, in the Kalami dashboard."
        : `"${week.title}" is published, so only the lecturer can change it. Ask them to unpublish it first, or add a new draft lesson to it.`,
    );
  }
  return { week, course };
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

function requireIdle(week: Doc<"weeks">, now: number) {
  requireReadingIdle(week);
  if (week.syncing !== undefined && !isStale(week, now)) {
    throw appError("CONFLICT", "Google Drive is still working on this week. Give it a moment.");
  }
}

export function requireReadingIdle(week: Doc<"weeks">) {
  if (week.readingWrite && week.readingWrite.until > Date.now()) {
    throw appError("CONFLICT", "A reading document is being saved. Wait for it to finish, then try again.");
  }
}

/** Only https links, with a real host, no credentials in them. */
export function requireHttpsUrl(raw: string, label = "link"): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw appError("INVALID_INPUT", `Enter a full ${label} that starts with https://`);
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username !== "" || url.password !== "") {
    throw appError("INVALID_INPUT", `Enter a full ${label} that starts with https://`);
  }
  if (url.href.length > 2000) {
    throw appError("INVALID_INPUT", `That ${label} is too long.`);
  }
  return url.href;
}

function linkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requireLink(input: { title: string; url: string }): Omit<WeekLink, "id"> {
  return { title: requireText(input.title, "Link title", 120), url: requireHttpsUrl(input.url) };
}

// --- Changing weeks ---------------------------------------------------------------------

export async function createWeek(
  ctx: MutationCtx,
  actor: Actor,
  args: {
    courseId: Id<"courses">;
    title?: string;
    description?: string;
    links?: { title: string; url: string }[];
    /** Also create its folder in the actor's Google Drive. */
    driveFolder?: boolean;
  },
): Promise<Id<"weeks">> {
  const { course } = await requireCourseContentEditor(ctx, actor, args.courseId);
  const weeks = await weeksOf(ctx, args.courseId);
  if (weeks.length >= MAX_WEEKS) {
    throw appError("CONFLICT", `A course can have at most ${MAX_WEEKS} weeks.`);
  }
  const title =
    args.title === undefined || args.title.trim() === ""
      ? course.locale === "ka"
        ? `კვირა ${weeks.length + 1}`
        : `Week ${weeks.length + 1}`
      : requireText(args.title, "Title", 120);
  const links = (args.links ?? []).map((link) => ({ id: linkId(), ...requireLink(link) }));
  if (links.length > MAX_LINKS) {
    throw appError("INVALID_INPUT", `A week can have at most ${MAX_LINKS} links.`);
  }
  const now = Date.now();
  const weekId = await ctx.db.insert("weeks", {
    courseId: args.courseId,
    order: weeks.length === 0 ? 1 : weeks[weeks.length - 1].order + 1,
    title,
    description: optionalText(args.description, "Description", 2000),
    status: "draft",
    links,
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: now,
  });
  if (args.driveFolder) {
    await startDriveFolder(ctx, actor, (await ctx.db.get("weeks", weekId))!);
  }
  await logAudit(ctx, actor, {
    action: "week.create",
    targetTable: "weeks",
    targetId: weekId,
    courseId: args.courseId,
    summary: `Added "${title}" to "${course.title}"`,
  });
  return weekId;
}

export async function updateWeek(
  ctx: MutationCtx,
  actor: Actor,
  weekId: Id<"weeks">,
  patch: { title?: string; description?: string },
) {
  await requireWeek(ctx, actor, weekId);
  const changes: Partial<Doc<"weeks">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", 120);
  if (patch.description !== undefined) changes.description = optionalText(patch.description, "Description", 2000);
  await ctx.db.patch("weeks", weekId, { ...changes, updatedAt: Date.now() });
}

/** Puts the weeks in this order (every week of the course, each once). */
export async function reorderWeeks(ctx: MutationCtx, actor: Actor, courseId: Id<"courses">, weekIds: Id<"weeks">[]) {
  await requireCourseContentEditor(ctx, actor, courseId);
  const weeks = await weeksOf(ctx, courseId);
  const known = new Set(weeks.map((w) => w._id));
  if (weekIds.length !== weeks.length || new Set(weekIds).size !== weekIds.length || weekIds.some((id) => !known.has(id))) {
    throw appError("INVALID_INPUT", "List every week of the course exactly once.");
  }
  if (actor.via === "mcp") {
    keepsPublishedOrder(weeks, weekIds, "weeks");
  }
  for (const [index, id] of weekIds.entries()) {
    const week = weeks.find((w) => w._id === id)!;
    if (week.order !== index + 1) {
      await ctx.db.patch("weeks", id, { order: index + 1 });
    }
  }
}

/**
 * Agents may move drafts anywhere, but what students already see keeps its
 * order: the published items must come out in the same order as before.
 */
export function keepsPublishedOrder<T extends { _id: string; status: string }>(
  current: T[],
  order: string[],
  what: "weeks" | "lessons",
): void {
  const published = new Set(current.filter((item) => item.status === "published").map((item) => item._id));
  const before = current.filter((item) => published.has(item._id)).map((item) => item._id);
  const after = order.filter((id) => published.has(id));
  if (before.some((id, index) => after[index] !== id)) {
    throw appError(
      "CONFLICT",
      `Students already see the published ${what} in this order. Move only drafts, or ask the lecturer to reorder published ${what}.`,
    );
  }
}

/** Swaps the week with its neighbour above or below. */
export async function moveWeek(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">, direction: "up" | "down") {
  const { week } = await requireWeek(ctx, actor, weekId);
  const weeks = await weeksOf(ctx, week.courseId);
  const index = weeks.findIndex((w) => w._id === weekId);
  const other = weeks[direction === "up" ? index - 1 : index + 1];
  if (other === undefined) {
    return;
  }
  await ctx.db.patch("weeks", week._id, { order: other.order });
  await ctx.db.patch("weeks", other._id, { order: week.order });
}

/**
 * Students see the week: its lessons (drafts are published along with it),
 * its links, and its Drive folder once Google has shared it.
 */
export async function publishWeek(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const { week, course } = await requireWeek(ctx, actor, weekId, "publish");
  const now = Date.now();
  requireIdle(week, now);
  const sharing = week.folderId !== undefined && week.permissionId === undefined;
  if (sharing) {
    await requireDriveOwner(ctx, actor, week.courseId);
  }
  await ctx.db.patch("weeks", weekId, {
    status: "published",
    publishedAt: week.publishedAt ?? now,
    driveError: undefined,
    syncing: sharing ? "share" : undefined,
    syncingSince: sharing ? now : undefined,
    updatedAt: now,
  });
  for (const lesson of await lessonsOf(ctx, weekId)) {
    if (lesson.status === "draft") {
      await ctx.db.patch("lessons", lesson._id, { status: "published", publishedAt: lesson.publishedAt ?? now });
    }
  }
  if (sharing) {
    await ctx.scheduler.runAfter(0, internal.drive.shareWeek, { weekId, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "week.publish",
    targetTable: "weeks",
    targetId: weekId,
    courseId: week.courseId,
    summary: `Published "${week.title}" in "${course.title}"`,
  });
}

/**
 * Hides the week from students and, for Drive, takes the link sharing off its
 * folder. Any course editor may do this: it only ever closes access.
 */
export async function unpublishWeek(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const { week, course } = await requireWeek(ctx, actor, weekId, "publish");
  const now = Date.now();
  requireIdle(week, now);
  const unsharing = week.permissionId !== undefined;
  await ctx.db.patch("weeks", weekId, {
    status: "draft",
    driveError: undefined,
    syncing: unsharing ? "unshare" : undefined,
    syncingSince: unsharing ? now : undefined,
    updatedAt: now,
  });
  if (unsharing) {
    await ctx.scheduler.runAfter(0, internal.drive.unshareWeek, { weekId, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "week.unpublish",
    targetTable: "weeks",
    targetId: weekId,
    courseId: week.courseId,
    summary: `Hid "${week.title}" in "${course.title}"`,
  });
}

/**
 * Removes a draft week: its lessons go, its tasks and quizzes become unplaced
 * (never deleted), and its Drive folder stays in the lecturer's Drive.
 */
export async function removeWeek(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const { week, course } = await requireWeek(ctx, actor, weekId);
  requireIdle(week, Date.now());
  if (week.status === "published" || week.permissionId !== undefined) {
    throw appError("CONFLICT", "Unpublish this week first, so students stop seeing it.");
  }
  const lessons = await lessonsOf(ctx, weekId);
  if (actor.via === "mcp" && lessons.some((lesson) => lesson.status === "published")) {
    throw appError(
      "CONFLICT",
      `"${week.title}" has lessons the lecturer published. Only the lecturer can delete it, in the Kalami dashboard.`,
    );
  }
  for (const lesson of lessons) {
    await ctx.db.delete("lessons", lesson._id);
  }
  const placed = await ctx.db
    .query("assessments")
    .withIndex("by_courseId", (q) => q.eq("courseId", week.courseId))
    .take(500);
  for (const assessment of placed) {
    if (assessment.weekId === weekId) {
      await ctx.db.patch("assessments", assessment._id, { weekId: undefined });
    }
  }
  await ctx.db.delete("weeks", weekId);
  for (const reading of await ctx.db.query("readingDocuments").withIndex("by_weekId_and_key", (q) => q.eq("weekId", weekId)).take(100)) {
    await ctx.db.delete("readingDocuments", reading._id);
  }
  await logAudit(ctx, actor, {
    action: "week.remove",
    targetTable: "weeks",
    targetId: weekId,
    courseId: week.courseId,
    summary: `Removed "${week.title}" from "${course.title}"`,
  });
}

// --- Links ------------------------------------------------------------------------------

export async function addLinks(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">, links: { title: string; url: string }[]) {
  const { week } = await requireWeek(ctx, actor, weekId);
  if (week.links.length + links.length > MAX_LINKS) {
    throw appError("CONFLICT", `A week can have at most ${MAX_LINKS} links.`);
  }
  const added = links.map((link) => ({ id: linkId(), ...requireLink(link) }));
  await ctx.db.patch("weeks", weekId, { links: [...week.links, ...added], updatedAt: Date.now() });
  return added.map((link) => link.id);
}

export async function updateLink(
  ctx: MutationCtx,
  actor: Actor,
  weekId: Id<"weeks">,
  linkIdToChange: string,
  input: { title: string; url: string },
) {
  const { week } = await requireWeek(ctx, actor, weekId);
  if (!week.links.some((link) => link.id === linkIdToChange)) {
    throw appError("NOT_FOUND", "Link not found.");
  }
  const fresh = requireLink(input);
  await ctx.db.patch("weeks", weekId, {
    links: week.links.map((link) => (link.id === linkIdToChange ? { id: link.id, ...fresh } : link)),
    updatedAt: Date.now(),
  });
}

export async function removeLink(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">, linkIdToRemove: string) {
  const { week } = await requireWeek(ctx, actor, weekId);
  await ctx.db.patch("weeks", weekId, {
    links: week.links.filter((link) => link.id !== linkIdToRemove),
    updatedAt: Date.now(),
  });
}

export async function moveLink(
  ctx: MutationCtx,
  actor: Actor,
  weekId: Id<"weeks">,
  linkIdToMove: string,
  direction: "up" | "down",
) {
  const { week } = await requireWeek(ctx, actor, weekId);
  const links = [...week.links];
  const index = links.findIndex((link) => link.id === linkIdToMove);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= links.length) {
    return;
  }
  [links[index], links[target]] = [links[target], links[index]];
  await ctx.db.patch("weeks", weekId, { links, updatedAt: Date.now() });
}

/** Puts the week's links in this order (every link id once). */
export async function reorderLinks(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">, linkIds: string[]) {
  const { week } = await requireWeek(ctx, actor, weekId);
  const byId = new Map(week.links.map((link) => [link.id, link]));
  if (linkIds.length !== week.links.length || new Set(linkIds).size !== linkIds.length || linkIds.some((id) => !byId.has(id))) {
    throw appError("INVALID_INPUT", "List every link of the week exactly once.");
  }
  await ctx.db.patch("weeks", weekId, { links: linkIds.map((id) => byId.get(id)!), updatedAt: Date.now() });
}

// --- Drive ------------------------------------------------------------------------------

async function startDriveFolder(ctx: MutationCtx, actor: Actor, week: Doc<"weeks">) {
  if (!driveConfigured()) {
    throw appError("CONFLICT", "Google Drive isn't set up on this Kalami server yet. Add links instead.");
  }
  const drive = await requireDriveOwner(ctx, actor, week.courseId);
  const now = Date.now();
  if (drive === null) {
    await ctx.db.insert("courseDrive", { courseId: week.courseId, ownerId: actor.user._id, updatedAt: now });
  }
  await ctx.db.patch("weeks", week._id, { syncing: "folder", syncingSince: now, driveError: undefined, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { weekId: week._id, attempt: 0 });
}

/** Creates the week's folder in the actor's Drive (the course folder too, the first time). */
export async function addDriveFolder(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const { week } = await requireWeek(ctx, actor, weekId);
  requireIdle(week, Date.now());
  if (week.folderId !== undefined) {
    return;
  }
  await startDriveFolder(ctx, actor, week);
}

/** Runs again whatever Drive step failed or got stuck: the folder, sharing, or unsharing. */
export async function retryDrive(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const { week } = await requireWeek(ctx, actor, weekId);
  const now = Date.now();
  requireIdle(week, now);
  let job: "folder" | "share" | "unshare" | null = null;
  if (week.folderId === undefined) job = "folder";
  else if (week.status === "published" && week.permissionId === undefined) job = "share";
  else if (week.status === "draft" && week.permissionId !== undefined) job = "unshare";
  if (job === null) {
    await ctx.db.patch("weeks", weekId, { driveError: undefined, syncing: undefined, syncingSince: undefined });
    return;
  }
  if (job !== "unshare") {
    await requireDriveOwner(ctx, actor, week.courseId);
  }
  await ctx.db.patch("weeks", weekId, { syncing: job, syncingSince: now, driveError: undefined });
  if (job === "folder") {
    await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { weekId, attempt: 0 });
  } else if (job === "share") {
    await ctx.scheduler.runAfter(0, internal.drive.shareWeek, { weekId, attempt: 0 });
  } else {
    await ctx.scheduler.runAfter(0, internal.drive.unshareWeek, { weekId, attempt: 0 });
  }
}

/**
 * Moves a course's Drive to the actor's own when its owner can't continue.
 * Kalami forgets the old folders (they stay in the old owner's Drive; folders
 * shared there stay shared, since nobody can reach that Drive any more), every
 * week with a folder goes back to draft, and new folders get created in the
 * actor's Drive. Links and lessons are untouched.
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
  for (const week of await weeksOf(ctx, courseId)) requireReadingIdle(week);
  const now = Date.now();
  await ctx.db.patch("courseDrive", drive._id, {
    ownerId: actor.user._id,
    folderId: undefined,
    creatingSince: undefined,
    error: undefined,
    updatedAt: now,
  });
  for (const week of await weeksOf(ctx, courseId)) {
    if (week.folderId === undefined && week.syncing === undefined && week.permissionId === undefined) continue;
    await ctx.db.patch("weeks", week._id, {
      status: "draft",
      folderId: undefined,
      permissionId: undefined,
      syncing: "folder",
      syncingSince: now,
      driveError: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.drive.createWeekFolder, { weekId: week._id, attempt: 0 });
  }
  await logAudit(ctx, actor, {
    action: "course.takeOverDrive",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Moved the materials of "${course.title}" from ${previous}'s Google Drive to their own`,
  });
}

// --- Placing tasks and quizzes ----------------------------------------------------------

/** Puts a task or quiz into a week of its course, or (null) back among the unplaced. */
export async function placeAssessment(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  weekId: Id<"weeks"> | null,
) {
  const { assessment } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  if (actor.via === "mcp" && assessment.status !== "draft") {
    throw appError("CONFLICT", "Only the lecturer can move a published assessment.");
  }
  if (!isWeekKind(assessment)) {
    throw appError("INVALID_INPUT", "Midterms and finals stay in the course's Exams section.");
  }
  if (weekId !== null) {
    const week = await ctx.db.get("weeks", weekId);
    if (week === null || week.courseId !== assessment.courseId) {
      throw appError("NOT_FOUND", "Week not found in this course.");
    }
  }
  await ctx.db.patch("assessments", assessmentId, { weekId: weekId ?? undefined });
}

// --- Students ---------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** The published weeks students see, with their published lessons and materials. */
export async function publishedWeeks(ctx: QueryCtx, courseId: Id<"courses">) {
  const out = [];
  for (const week of await weeksOf(ctx, courseId)) {
    if (week.status !== "published") continue;
    const lessons = (await lessonsOf(ctx, week._id)).filter((lesson) => lesson.status === "published");
    out.push({
      _id: week._id,
      title: week.title,
      description: week.description,
      links: week.links.map((link) => ({ ...link, host: hostOf(link.url) })),
      driveUrl: week.folderId && week.permissionId ? folderUrl(week.folderId) : undefined,
      lessons: lessons.map((lesson) => ({ _id: lesson._id, title: lesson.title })),
    });
  }
  return out;
}
