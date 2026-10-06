import type { PaginationOptions, PaginationResult } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { emailConfigured, sendAnnouncementEmail } from "../email";
import { getMemberships, isSuperAdmin } from "../lib/auth";
import { appError } from "../lib/errors";
import { normalizeEmail } from "../lib/input";
import { enforceLimit } from "../lib/limits";
import {
  broadcastAudienceValidator,
  broadcastChannelsValidator,
  localizedTextValidator,
  roleValidator,
  type BroadcastAudience,
  type BroadcastChannels,
  type Role,
} from "../lib/validators";
import { pushConfigured } from "../push";
import { displayName, logAudit } from "./audit";
import { actorOf, covers, type AdminScope } from "./platform";

/**
 * The admin panel's notification center: a message from an admin to many
 * people at once. The audience is a rule (everyone, a role, a university, a
 * group, a course, a list of people) turned into rows a batch at a time by a
 * scheduled mutation. Students get a row in the bell (the record), a push to
 * their devices and an email as chosen; staff get the email. One delivery row
 * per person says what they got, so a retried batch never doubles anything.
 */

/** People handled per scheduled mutation. */
const BATCH = 100;
/** People an admin can pick one by one for a single message. */
const MAX_PEOPLE = 200;
/** People the preview counts before it says "more than". */
const PREVIEW_CAP = 1000;
const HISTORY = 50;
const TITLE_MAX = 120;
const BODY_MAX = 2000;
const LINK_MAX = 500;
const SEARCH_CAP = 25;

const KALAMI = { ka: "კალამი", en: "Kalami" };

// --- Validators ---------------------------------------------------------------------------

export const emailSkipValidator = v.union(
  v.literal("off"),
  v.literal("opted_out"),
  v.literal("blocked"),
  v.literal("not_configured"),
);

export const audiencePreviewValidator = v.object({
  recipients: v.number(),
  students: v.number(),
  staff: v.number(),
  /** Students with at least one device that has push on. */
  withPush: v.number(),
  /** Who gets the email, and who doesn't and why. */
  emailable: v.number(),
  optedOut: v.number(),
  blocked: v.number(),
  /** Counting stopped at the cap: the real numbers are higher. */
  capped: v.boolean(),
  emailConfigured: v.boolean(),
  pushConfigured: v.boolean(),
});

export const broadcastRowValidator = v.object({
  _id: v.id("broadcasts"),
  _creationTime: v.number(),
  senderName: v.string(),
  from: localizedTextValidator,
  title: v.string(),
  body: v.string(),
  link: v.optional(v.string()),
  audienceLabel: v.string(),
  channels: broadcastChannelsValidator,
  emailEveryone: v.boolean(),
  status: v.union(v.literal("sending"), v.literal("sent")),
  recipients: v.number(),
  inApp: v.number(),
  pushed: v.number(),
  emailed: v.number(),
  finishedAt: v.optional(v.number()),
});

export const deliveryRowValidator = v.object({
  _id: v.id("broadcastDeliveries"),
  userId: v.id("users"),
  name: v.string(),
  email: v.string(),
  role: roleValidator,
  /** In the student app's bell. */
  inApp: v.boolean(),
  devices: v.number(),
  emailed: v.boolean(),
  emailSkipped: v.optional(emailSkipValidator),
});

export const personHitValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  email: v.string(),
  roles: v.array(roleValidator),
  universityName: v.optional(localizedTextValidator),
});

// --- The audience as rows -------------------------------------------------------------------

/** Where one part of an audience is read from. `universityId: null` means every university. */
type Source =
  | { table: "users" }
  | { table: "memberships"; role: Role; universityId: Id<"universities"> | undefined | null }
  | { table: "groupMembers"; groupId: Id<"groups"> }
  | { table: "enrollments"; courseId: Id<"courses"> }
  | { table: "list"; userIds: Id<"users">[] };

function universityOf(value: Id<"universities"> | "none" | undefined): Id<"universities"> | undefined | null {
  return value === undefined ? null : value === "none" ? undefined : value;
}

function sourcesOf(audience: BroadcastAudience): Source[] {
  switch (audience.kind) {
    case "everyone":
      return [{ table: "users" }];
    case "students":
      return [{ table: "memberships", role: "student", universityId: universityOf(audience.universityId) }];
    case "staff":
      return (["lecturer", "uni_admin"] as const).map((role) => ({
        table: "memberships" as const,
        role,
        universityId: universityOf(audience.universityId),
      }));
    case "university":
      return (["student", "lecturer", "uni_admin"] as const).map((role) => ({
        table: "memberships" as const,
        role,
        universityId: audience.universityId,
      }));
    case "group":
      return [{ table: "groupMembers", groupId: audience.groupId }];
    case "course":
      return [{ table: "enrollments", courseId: audience.courseId }];
    case "people":
      return [{ table: "list", userIds: audience.userIds }];
  }
}

type Page = { userIds: Id<"users">[]; cursor: string | null; done: boolean };

/** One page of a source, for the fan-out (a mutation may paginate once per call). */
async function pageOf(ctx: QueryCtx, source: Source, cursor: string | null, numItems: number): Promise<Page> {
  const opts = { numItems, cursor };
  switch (source.table) {
    case "users": {
      const result = await ctx.db.query("users").paginate(opts);
      return { userIds: result.page.map((row) => row._id), cursor: result.continueCursor, done: result.isDone };
    }
    case "memberships": {
      const { role, universityId } = source;
      const result =
        universityId === null
          ? await ctx.db
              .query("memberships")
              .withIndex("by_role_and_universityId", (q) => q.eq("role", role))
              .paginate(opts)
          : await ctx.db
              .query("memberships")
              .withIndex("by_universityId_and_role", (q) => q.eq("universityId", universityId).eq("role", role))
              .paginate(opts);
      return { userIds: result.page.map((row) => row.userId), cursor: result.continueCursor, done: result.isDone };
    }
    case "groupMembers": {
      const { groupId } = source;
      const result = await ctx.db
        .query("groupMembers")
        .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
        .paginate(opts);
      return { userIds: result.page.map((row) => row.userId), cursor: result.continueCursor, done: result.isDone };
    }
    case "enrollments": {
      const { courseId } = source;
      const result = await ctx.db
        .query("enrollments")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .paginate(opts);
      return {
        userIds: result.page.filter((row) => row.status === "active").map((row) => row.userId),
        cursor: result.continueCursor,
        done: result.isDone,
      };
    }
    case "list": {
      const start = cursor === null ? 0 : Number(cursor);
      const slice = source.userIds.slice(start, start + numItems);
      const end = start + slice.length;
      return { userIds: slice, cursor: String(end), done: end >= source.userIds.length };
    }
  }
}

/** Up to `limit` people of a source, for the preview (queries read with take, not paginate). */
async function takeOf(ctx: QueryCtx, source: Source, limit: number): Promise<Id<"users">[]> {
  switch (source.table) {
    case "users":
      return (await ctx.db.query("users").take(limit)).map((row) => row._id);
    case "memberships": {
      const { role, universityId } = source;
      const rows =
        universityId === null
          ? await ctx.db
              .query("memberships")
              .withIndex("by_role_and_universityId", (q) => q.eq("role", role))
              .take(limit)
          : await ctx.db
              .query("memberships")
              .withIndex("by_universityId_and_role", (q) => q.eq("universityId", universityId).eq("role", role))
              .take(limit);
      return rows.map((row) => row.userId);
    }
    case "groupMembers": {
      const { groupId } = source;
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
        .take(limit);
      return rows.map((row) => row.userId);
    }
    case "enrollments": {
      const { courseId } = source;
      const rows = await ctx.db
        .query("enrollments")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .take(limit);
      return rows.filter((row) => row.status === "active").map((row) => row.userId);
    }
    case "list":
      return source.userIds.slice(0, limit);
  }
}

// --- Checking an audience against the caller -------------------------------------------------

type CheckedAudience = { audience: BroadcastAudience; label: string; universityId: Id<"universities"> | undefined };

async function universityName(ctx: QueryCtx, universityId: Id<"universities">): Promise<string> {
  const university = await ctx.db.get("universities", universityId);
  if (university === null) {
    throw appError("NOT_FOUND", "That university no longer exists.");
  }
  return university.name.en;
}

function requireCovered(scope: AdminScope, universityId: Id<"universities"> | undefined, what: string) {
  if (!covers(scope, universityId)) {
    throw appError("FORBIDDEN", `That ${what} isn't in a university you administer.`);
  }
}

/** Whether this account is within the caller's reach: any membership at a university they administer. */
function inReach(scope: AdminScope, memberships: Doc<"memberships">[]): boolean {
  return scope.isSuperAdmin || memberships.some((m) => covers(scope, m.universityId));
}

/**
 * The audience the caller may address, in words. A university admin reaches
 * their own university's people, groups and courses; only the platform admin
 * messages everyone, a whole role across universities, or people outside any.
 */
async function checkAudience(ctx: QueryCtx, scope: AdminScope, audience: BroadcastAudience): Promise<CheckedAudience> {
  switch (audience.kind) {
    case "everyone":
      if (!scope.isSuperAdmin) {
        throw appError("FORBIDDEN", "Only the platform admin can message everyone on Kalami.");
      }
      return { audience, label: "Everyone on Kalami", universityId: undefined };
    case "students":
    case "staff": {
      const who = audience.kind === "students" ? "All students" : "All lecturers and admins";
      const at = audience.universityId;
      if (at === undefined || at === "none") {
        if (!scope.isSuperAdmin) {
          throw appError("FORBIDDEN", "Pick your university.");
        }
        return { audience, label: at === "none" ? `${who} outside any university` : who, universityId: undefined };
      }
      requireCovered(scope, at, "university");
      return { audience, label: `${who} at ${await universityName(ctx, at)}`, universityId: at };
    }
    case "university":
      requireCovered(scope, audience.universityId, "university");
      return {
        audience,
        label: `Everyone at ${await universityName(ctx, audience.universityId)}`,
        universityId: audience.universityId,
      };
    case "group": {
      const group = await ctx.db.get("groups", audience.groupId);
      if (group === null || !covers(scope, group.universityId)) {
        throw appError("NOT_FOUND", "That group isn't in a university you administer.");
      }
      const where = group.universityId === undefined ? "" : ` (${await universityName(ctx, group.universityId)})`;
      return { audience, label: `Group ${group.name}${where}`, universityId: group.universityId };
    }
    case "course": {
      const course = await ctx.db.get("courses", audience.courseId);
      if (course === null || !covers(scope, course.universityId)) {
        throw appError("NOT_FOUND", "That course isn't in a university you administer.");
      }
      return { audience, label: `Course ${course.title}`, universityId: course.universityId };
    }
    case "people": {
      const userIds = [...new Set(audience.userIds)];
      if (userIds.length === 0) {
        throw appError("INVALID_INPUT", "Pick at least one person.");
      }
      if (userIds.length > MAX_PEOPLE) {
        throw appError("INVALID_INPUT", `Pick up to ${MAX_PEOPLE} people, or address a group, a course or a university.`);
      }
      const names: string[] = [];
      for (const userId of userIds) {
        const user = await ctx.db.get("users", userId);
        if (user === null || user.deletedAt !== undefined || !inReach(scope, await getMemberships(ctx, userId))) {
          throw appError("NOT_FOUND", "One of the people isn't in a university you administer.");
        }
        names.push(displayName(user));
      }
      const shown = names.slice(0, 3).join(", ");
      const label =
        names.length <= 3 ? shown : `${shown} and ${names.length - 3} ${names.length - 3 === 1 ? "other" : "others"}`;
      return { audience: { kind: "people", userIds }, label, universityId: undefined };
    }
  }
}

/** Who people see it from: Kalami itself, or the university whose admin sent it. */
async function fromLabel(ctx: QueryCtx, scope: AdminScope, checked: CheckedAudience) {
  if (scope.isSuperAdmin) return KALAMI;
  const universityId = checked.universityId ?? scope.universityIds?.[0];
  const university = universityId === undefined ? null : await ctx.db.get("universities", universityId);
  return university?.name ?? KALAMI;
}

function cleanLink(raw: string | undefined): string | undefined {
  const link = raw?.trim();
  if (!link) return undefined;
  if (link.length > LINK_MAX || !(/^\/\S*$/.test(link) || /^https:\/\/\S+$/.test(link))) {
    throw appError("INVALID_INPUT", "The link must be a path in the student app (/courses/…) or an https:// address.");
  }
  return link;
}

// --- Preview, send, fan out --------------------------------------------------------------------

async function hasDevice(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const row = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row !== null;
}

/** Who a message would reach, counted up to a cap, with the email and push outlook. */
export async function previewAudience(ctx: QueryCtx, scope: AdminScope, audience: BroadcastAudience, emailEveryone: boolean) {
  const checked = await checkAudience(ctx, scope, audience);
  const counts = { recipients: 0, students: 0, staff: 0, withPush: 0, emailable: 0, optedOut: 0, blocked: 0 };
  const seen = new Set<Id<"users">>();
  let capped = false;
  for (const source of sourcesOf(checked.audience)) {
    const userIds = await takeOf(ctx, source, PREVIEW_CAP + 1);
    for (const userId of userIds) {
      if (seen.has(userId)) continue;
      if (seen.size >= PREVIEW_CAP) {
        capped = true;
        break;
      }
      seen.add(userId);
      const user = await ctx.db.get("users", userId);
      if (user === null || user.deletedAt !== undefined) continue;
      const memberships = await getMemberships(ctx, userId);
      if (memberships.length === 0) continue;
      const student = memberships.some((m) => m.role === "student");
      counts.recipients++;
      if (student) {
        counts.students++;
        if (await hasDevice(ctx, userId)) counts.withPush++;
      } else {
        counts.staff++;
      }
      if (user.emailStatus !== undefined) counts.blocked++;
      else if (user.emailOptOut === true && !emailEveryone) counts.optedOut++;
      else counts.emailable++;
    }
    if (capped) break;
  }
  return { ...counts, capped, emailConfigured: emailConfigured(), pushConfigured: pushConfigured() };
}

/** Writes the broadcast and starts its first batch. Returns its id; the counts fill in as the batches run. */
export async function createBroadcast(
  ctx: MutationCtx,
  scope: AdminScope,
  input: {
    title: string;
    body: string;
    link?: string;
    audience: BroadcastAudience;
    channels: BroadcastChannels;
    emailEveryone: boolean;
  },
): Promise<Id<"broadcasts">> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > TITLE_MAX) {
    throw appError("INVALID_INPUT", `Give the message a title, up to ${TITLE_MAX} characters.`);
  }
  const body = input.body.trim();
  if (body.length === 0 || body.length > BODY_MAX) {
    throw appError("INVALID_INPUT", `Write the message, up to ${BODY_MAX} characters.`);
  }
  const link = cleanLink(input.link);
  const checked = await checkAudience(ctx, scope, input.audience);
  await enforceLimit(ctx, "broadcast", scope.user._id);
  const broadcastId = await ctx.db.insert("broadcasts", {
    senderId: scope.user._id,
    from: await fromLabel(ctx, scope, checked),
    title,
    body,
    link,
    audience: checked.audience,
    audienceLabel: checked.label,
    channels: input.channels,
    emailEveryone: input.emailEveryone,
    status: "sending",
    recipients: 0,
    inApp: 0,
    pushed: 0,
    emailed: 0,
  });
  await logAudit(ctx, actorOf(scope), {
    action: "broadcast.send",
    targetTable: "broadcasts",
    targetId: broadcastId,
    summary: `Sent "${title}" to ${checked.label}`,
  });
  await ctx.scheduler.runAfter(0, internal.broadcasts.fanOut, { broadcastId, phase: 0, cursor: null });
  return broadcastId;
}

async function deliveryOf(ctx: QueryCtx, broadcastId: Id<"broadcasts">, userId: Id<"users">) {
  return await ctx.db
    .query("broadcastDeliveries")
    .withIndex("by_broadcastId_and_userId", (q) => q.eq("broadcastId", broadcastId).eq("userId", userId))
    .unique();
}

/**
 * One batch of one part of the audience: a bell row for each student (pushed
 * to their devices when asked), an email for everyone when asked. Schedules
 * the next batch, the next part, or marks the broadcast sent.
 */
export async function fanOutBroadcast(
  ctx: MutationCtx,
  args: { broadcastId: Id<"broadcasts">; phase: number; cursor: string | null },
): Promise<void> {
  const broadcast = await ctx.db.get("broadcasts", args.broadcastId);
  if (broadcast === null || broadcast.status !== "sending") return;
  const sources = sourcesOf(broadcast.audience);
  const source = sources[args.phase];
  if (source === undefined) {
    await ctx.db.patch("broadcasts", broadcast._id, { status: "sent", finishedAt: Date.now() });
    return;
  }
  const page = await pageOf(ctx, source, args.cursor, BATCH);
  const toPush: Id<"notifications">[] = [];
  const counts = { recipients: 0, inApp: 0, pushed: 0, emailed: 0 };
  for (const userId of page.userIds) {
    if ((await deliveryOf(ctx, broadcast._id, userId)) !== null) continue;
    const user = await ctx.db.get("users", userId);
    if (user === null || user.deletedAt !== undefined) continue;
    const memberships = await getMemberships(ctx, userId);
    if (memberships.length === 0) continue;
    const sentBy = broadcast.from[user.locale];
    let notificationId: Id<"notifications"> | undefined;
    let devices = 0;
    if (memberships.some((m) => m.role === "student")) {
      notificationId = await ctx.db.insert("notifications", {
        userId,
        kind: "announcement",
        title: broadcast.title,
        courseTitle: sentBy,
        body: broadcast.body,
        broadcastId: broadcast._id,
        href: broadcast.link ?? "/dashboard",
      });
      counts.inApp++;
      if (broadcast.channels.push) {
        devices = (
          await ctx.db
            .query("pushSubscriptions")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .take(16)
        ).length;
        if (devices > 0) {
          counts.pushed++;
          toPush.push(notificationId);
        }
      }
    }
    let emailId: string | undefined;
    let emailSkipped: Doc<"broadcastDeliveries">["emailSkipped"];
    if (broadcast.channels.email) {
      const sent = await sendAnnouncementEmail(ctx, user, broadcast, sentBy);
      emailId = sent.emailId;
      emailSkipped = sent.skipped;
      if (emailId !== undefined) counts.emailed++;
    } else {
      emailSkipped = "off";
    }
    await ctx.db.insert("broadcastDeliveries", { broadcastId: broadcast._id, userId, notificationId, devices, emailId, emailSkipped });
    counts.recipients++;
  }
  await ctx.db.patch("broadcasts", broadcast._id, {
    recipients: broadcast.recipients + counts.recipients,
    inApp: broadcast.inApp + counts.inApp,
    pushed: broadcast.pushed + counts.pushed,
    emailed: broadcast.emailed + counts.emailed,
  });
  if (toPush.length > 0) {
    await ctx.scheduler.runAfter(0, internal.pushDelivery.deliver, { notificationIds: toPush });
  }
  if (!page.done) {
    await ctx.scheduler.runAfter(0, internal.broadcasts.fanOut, { ...args, cursor: page.cursor });
  } else if (args.phase + 1 < sources.length) {
    await ctx.scheduler.runAfter(0, internal.broadcasts.fanOut, { broadcastId: broadcast._id, phase: args.phase + 1, cursor: null });
  } else {
    await ctx.db.patch("broadcasts", broadcast._id, { status: "sent", finishedAt: Date.now() });
  }
}

// --- History ------------------------------------------------------------------------------

async function toBroadcastRow(ctx: QueryCtx, row: Doc<"broadcasts">) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    senderName: displayName(await ctx.db.get("users", row.senderId)),
    from: row.from,
    title: row.title,
    body: row.body,
    link: row.link,
    audienceLabel: row.audienceLabel,
    channels: row.channels,
    emailEveryone: row.emailEveryone,
    status: row.status,
    recipients: row.recipients,
    inApp: row.inApp,
    pushed: row.pushed,
    emailed: row.emailed,
    finishedAt: row.finishedAt,
  };
}

/** The newest messages: every one for the platform admin, their own for a university admin. */
export async function listBroadcasts(ctx: QueryCtx, scope: AdminScope) {
  const rows = scope.isSuperAdmin
    ? await ctx.db.query("broadcasts").order("desc").take(HISTORY)
    : await ctx.db
        .query("broadcasts")
        .withIndex("by_senderId", (q) => q.eq("senderId", scope.user._id))
        .order("desc")
        .take(HISTORY);
  const out = [];
  for (const row of rows) out.push(await toBroadcastRow(ctx, row));
  return out;
}

async function requireVisibleBroadcast(ctx: QueryCtx, scope: AdminScope, broadcastId: Id<"broadcasts">) {
  const broadcast = await ctx.db.get("broadcasts", broadcastId);
  if (broadcast === null || (!scope.isSuperAdmin && broadcast.senderId !== scope.user._id)) {
    throw appError("NOT_FOUND", "That message isn't yours to see.");
  }
  return broadcast;
}

const ROLE_ORDER: Role[] = ["student", "super_admin", "uni_admin", "lecturer"];

function primaryRole(memberships: Doc<"memberships">[]): Role {
  return ROLE_ORDER.find((role) => memberships.some((m) => m.role === role)) ?? "student";
}

type DeliveryRow = {
  _id: Id<"broadcastDeliveries">;
  userId: Id<"users">;
  name: string;
  email: string;
  role: Role;
  inApp: boolean;
  devices: number;
  emailed: boolean;
  emailSkipped: Doc<"broadcastDeliveries">["emailSkipped"];
};

/** Who one message reached and what each person got, a page at a time. */
export async function listRecipients(
  ctx: QueryCtx,
  scope: AdminScope,
  broadcastId: Id<"broadcasts">,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<DeliveryRow>> {
  await requireVisibleBroadcast(ctx, scope, broadcastId);
  const result = await ctx.db
    .query("broadcastDeliveries")
    .withIndex("by_broadcastId", (q) => q.eq("broadcastId", broadcastId))
    .paginate(paginationOpts);
  const page: DeliveryRow[] = [];
  for (const row of result.page) {
    const user = await ctx.db.get("users", row.userId);
    page.push({
      _id: row._id,
      userId: row.userId,
      name: displayName(user),
      email: user === null || user.deletedAt !== undefined ? "" : user.email,
      role: primaryRole(await getMemberships(ctx, row.userId)),
      inApp: row.notificationId !== undefined,
      devices: row.devices,
      emailed: row.emailId !== undefined,
      emailSkipped: row.emailSkipped,
    });
  }
  return { ...result, page };
}

// --- Picking people -------------------------------------------------------------------------

/** Accounts within reach whose email starts with the query (two characters at least): students and staff alike. */
export async function searchPeople(ctx: QueryCtx, scope: AdminScope, rawQuery: string) {
  const needle = normalizeEmail(rawQuery).slice(0, 254);
  if (needle.length < 2) return [];
  const users = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.gte("email", needle).lt("email", `${needle}￿`))
    .take(SEARCH_CAP);
  const out = [];
  for (const user of users) {
    if (user.deletedAt !== undefined) continue;
    const memberships = await getMemberships(ctx, user._id);
    if (memberships.length === 0) continue;
    if (!inReach(scope, memberships) && !(scope.isSuperAdmin && isSuperAdmin(memberships))) continue;
    const universityId = memberships.find((m) => m.universityId !== undefined)?.universityId;
    const university = universityId === undefined ? null : await ctx.db.get("universities", universityId);
    out.push({
      userId: user._id,
      name: displayName(user),
      email: user.email,
      roles: [...new Set(memberships.map((m) => m.role))],
      universityName: university?.name,
    });
  }
  return out;
}

export { broadcastAudienceValidator };
