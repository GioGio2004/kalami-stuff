import type { PaginationOptions, PaginationResult } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { emailConfigured, groupInviteUrl, sendAnnouncementEmail } from "../email";
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
import { isEmailAddress, openInviteFor } from "./groups";
import { actorOf, covers, type AdminScope } from "./platform";

/**
 * The admin panel's notification center: a message from an admin to many
 * people at once. The audience is a rule (everyone, a role, a university, a
 * group, a course, a list of people, a list of email addresses) turned into
 * rows a batch at a time by a scheduled mutation. Students get a row in the
 * bell (the record), a push to their devices and an email as chosen; staff
 * get the email; an address without an account gets the email only. A message
 * can double as a personal group invitation: each person gets their own join
 * link, so students can be invited before they have an account. One delivery
 * row per person says what they got, so a retried batch never doubles anything.
 */

/** People handled per scheduled mutation. */
const BATCH = 100;
/** People or addresses an admin can list one by one for a single message. */
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
  /** Addresses with no account the sender can reach: they get the email only. */
  noAccount: v.number(),
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
  /** The message was also an invitation to this group. */
  groupId: v.optional(v.id("groups")),
  groupName: v.optional(v.string()),
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
  userId: v.optional(v.id("users")),
  name: v.string(),
  email: v.string(),
  /** "none": an address the sender could only email (no account, or one outside their reach). */
  role: v.union(roleValidator, v.literal("none")),
  /** In the student app's bell. */
  inApp: v.boolean(),
  devices: v.number(),
  emailed: v.boolean(),
  emailSkipped: v.optional(emailSkipValidator),
  /** Got a personal invite to the group. */
  invited: v.boolean(),
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
  | { table: "list"; userIds: Id<"users">[] }
  | { table: "emails"; emails: string[] };

/** One person to reach: an account, or an address that may or may not have one. */
type Recipient = { userId: Id<"users"> } | { email: string };

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
    case "emails":
      return [{ table: "emails", emails: audience.emails }];
  }
}

type Page = { recipients: Recipient[]; cursor: string | null; done: boolean };

const byId = (userId: Id<"users">): Recipient => ({ userId });

function sliceOf<T>(items: T[], cursor: string | null, numItems: number) {
  const start = cursor === null ? 0 : Number(cursor);
  const slice = items.slice(start, start + numItems);
  const end = start + slice.length;
  return { slice, cursor: String(end), done: end >= items.length };
}

/** One page of a source, for the fan-out (a mutation may paginate once per call). */
async function pageOf(ctx: QueryCtx, source: Source, cursor: string | null, numItems: number): Promise<Page> {
  const opts = { numItems, cursor };
  switch (source.table) {
    case "users": {
      const result = await ctx.db.query("users").paginate(opts);
      return { recipients: result.page.map((row) => byId(row._id)), cursor: result.continueCursor, done: result.isDone };
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
      return { recipients: result.page.map((row) => byId(row.userId)), cursor: result.continueCursor, done: result.isDone };
    }
    case "groupMembers": {
      const { groupId } = source;
      const result = await ctx.db
        .query("groupMembers")
        .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
        .paginate(opts);
      return { recipients: result.page.map((row) => byId(row.userId)), cursor: result.continueCursor, done: result.isDone };
    }
    case "enrollments": {
      const { courseId } = source;
      const result = await ctx.db
        .query("enrollments")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .paginate(opts);
      return {
        recipients: result.page.filter((row) => row.status === "active").map((row) => byId(row.userId)),
        cursor: result.continueCursor,
        done: result.isDone,
      };
    }
    case "list": {
      const { slice, ...rest } = sliceOf(source.userIds, cursor, numItems);
      return { recipients: slice.map(byId), ...rest };
    }
    case "emails": {
      const { slice, ...rest } = sliceOf(source.emails, cursor, numItems);
      return { recipients: slice.map((email) => ({ email })), ...rest };
    }
  }
}

/** Up to `limit` people of a source, for the preview (queries read with take, not paginate). */
async function takeOf(ctx: QueryCtx, source: Source, limit: number): Promise<Recipient[]> {
  switch (source.table) {
    case "users":
      return (await ctx.db.query("users").take(limit)).map((row) => byId(row._id));
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
      return rows.map((row) => byId(row.userId));
    }
    case "groupMembers": {
      const { groupId } = source;
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
        .take(limit);
      return rows.map((row) => byId(row.userId));
    }
    case "enrollments": {
      const { courseId } = source;
      const rows = await ctx.db
        .query("enrollments")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .take(limit);
      return rows.filter((row) => row.status === "active").map((row) => byId(row.userId));
    }
    case "list":
      return source.userIds.slice(0, limit).map(byId);
    case "emails":
      return source.emails.slice(0, limit).map((email) => ({ email }));
  }
}

// --- Who a recipient turns out to be ---------------------------------------------------------

/** How far the sender's administration reaches: everything, or their universities. */
type Reach = { all: true } | { all: false; universityIds: Id<"universities">[] };

function reachOfScope(scope: AdminScope): Reach {
  return scope.universityIds === null ? { all: true } : { all: false, universityIds: scope.universityIds };
}

async function reachOfSender(ctx: QueryCtx, senderId: Id<"users">): Promise<Reach> {
  const memberships = await getMemberships(ctx, senderId);
  if (isSuperAdmin(memberships)) return { all: true };
  return {
    all: false,
    universityIds: memberships.flatMap((m) => (m.role === "uni_admin" && m.universityId !== undefined ? [m.universityId] : [])),
  };
}

function withinReach(reach: Reach, memberships: Doc<"memberships">[]): boolean {
  return reach.all || memberships.some((m) => m.universityId !== undefined && reach.universityIds.includes(m.universityId));
}

type Resolved =
  | { kind: "user"; user: Doc<"users">; memberships: Doc<"memberships">[]; student: boolean }
  | { kind: "address"; email: string };

async function userRecipient(ctx: QueryCtx, user: Doc<"users">): Promise<Resolved | null> {
  if (user.deletedAt !== undefined) return null;
  const memberships = await getMemberships(ctx, user._id);
  if (memberships.length === 0) return null;
  return { kind: "user", user, memberships, student: memberships.some((m) => m.role === "student") };
}

/**
 * An account id is the account (its reach was checked when the audience was).
 * An address is its account when one exists within the sender's reach, else
 * just an address to email. Null: nobody to reach (deleted, never onboarded).
 */
async function resolve(ctx: QueryCtx, recipient: Recipient, reach: Reach): Promise<Resolved | null> {
  if ("userId" in recipient) {
    const user = await ctx.db.get("users", recipient.userId);
    return user === null ? null : await userRecipient(ctx, user);
  }
  const users = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", recipient.email))
    .take(5);
  for (const user of users) {
    const resolved = await userRecipient(ctx, user);
    if (resolved !== null && resolved.kind === "user" && withinReach(reach, resolved.memberships)) return resolved;
  }
  return { kind: "address", email: recipient.email };
}

function keyOf(resolved: Resolved): string {
  return resolved.kind === "user" ? `u:${resolved.user._id}` : `e:${resolved.email}`;
}

// --- Checking an audience against the caller -------------------------------------------------

type CheckedAudience = { audience: BroadcastAudience; label: string; universityId: Id<"universities"> | undefined; count?: number };

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

/** Splits a pasted list and keeps each address once; bad ones are an error, named. */
function cleanEmails(raw: string[]): string[] {
  const emails: string[] = [];
  const bad: string[] = [];
  for (const entry of raw.flatMap((value) => value.split(/[\s,;]+/))) {
    const email = normalizeEmail(entry);
    if (email === "") continue;
    if (!isEmailAddress(email)) bad.push(entry.trim());
    else if (!emails.includes(email)) emails.push(email);
  }
  if (bad.length > 0) {
    throw appError(
      "INVALID_INPUT",
      `These don't look like email addresses: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ", …" : ""}.`,
    );
  }
  if (emails.length === 0) {
    throw appError("INVALID_INPUT", "Paste at least one email address.");
  }
  if (emails.length > MAX_PEOPLE) {
    throw appError("INVALID_INPUT", `Up to ${MAX_PEOPLE} addresses in one message.`);
  }
  return emails;
}

/**
 * The audience the caller may address, in words. A university admin reaches
 * their own university's people, groups and courses; only the platform admin
 * messages everyone, a whole role across universities, or people outside any.
 * Pasted addresses are anyone's to message: an account outside the caller's
 * reach gets the email only, like an address without one.
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
      return { audience: { kind: "people", userIds }, label, universityId: undefined, count: userIds.length };
    }
    case "emails": {
      const emails = cleanEmails(audience.emails);
      return {
        audience: { kind: "emails", emails },
        label: `${emails.length} email address${emails.length === 1 ? "" : "es"}`,
        universityId: undefined,
        count: emails.length,
      };
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

/** Whether an address is on the list Kalami no longer emails (bounced, complained, unsubscribed). */
async function isListed(ctx: QueryCtx, email: string): Promise<boolean> {
  const row = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  return row !== null;
}

/** Who a message would reach, counted up to a cap, with the email and push outlook. */
export async function previewAudience(ctx: QueryCtx, scope: AdminScope, audience: BroadcastAudience, emailEveryone: boolean) {
  const checked = await checkAudience(ctx, scope, audience);
  const reach = reachOfScope(scope);
  const counts = { recipients: 0, students: 0, staff: 0, noAccount: 0, withPush: 0, emailable: 0, optedOut: 0, blocked: 0 };
  const seen = new Set<string>();
  let capped = false;
  for (const source of sourcesOf(checked.audience)) {
    for (const recipient of await takeOf(ctx, source, PREVIEW_CAP + 1)) {
      if (seen.size >= PREVIEW_CAP) {
        capped = true;
        break;
      }
      const resolved = await resolve(ctx, recipient, reach);
      if (resolved === null) continue;
      const key = keyOf(resolved);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.recipients++;
      if (resolved.kind === "address") {
        counts.noAccount++;
        if (await isListed(ctx, resolved.email)) counts.blocked++;
        else counts.emailable++;
        continue;
      }
      if (resolved.student) {
        counts.students++;
        if (await hasDevice(ctx, resolved.user._id)) counts.withPush++;
      } else {
        counts.staff++;
      }
      if (resolved.user.emailStatus !== undefined || (await isListed(ctx, resolved.user.email))) counts.blocked++;
      else if (resolved.user.emailOptOut === true && !emailEveryone) counts.optedOut++;
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
    /** The message is also a personal invitation to this group (addresses or picked people only). */
    groupId?: Id<"groups">;
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
  let group: Doc<"groups"> | null = null;
  if (input.groupId !== undefined) {
    if (checked.count === undefined) {
      throw appError("INVALID_INPUT", "An invitation goes to email addresses or to people picked one by one.");
    }
    group = await ctx.db.get("groups", input.groupId);
    if (group === null || !covers(scope, group.universityId)) {
      throw appError("NOT_FOUND", "That group isn't in a university you administer.");
    }
    if (group.archivedAt !== undefined) {
      throw appError("CONFLICT", "This group is archived. Restore it to invite students.");
    }
    // The same allowance as inviting from the group's page.
    await enforceLimit(ctx, "groupInvite", scope.user._id, checked.count);
  }
  await enforceLimit(ctx, "broadcast", scope.user._id);
  const label = group === null ? checked.label : `${checked.label}, invited to ${group.name}`;
  const broadcastId = await ctx.db.insert("broadcasts", {
    senderId: scope.user._id,
    from: await fromLabel(ctx, scope, checked),
    title,
    body,
    link,
    groupId: group?._id,
    audience: checked.audience,
    audienceLabel: label,
    // An invitation can only reach people without an account by email.
    channels: { push: input.channels.push, email: input.channels.email || group !== null },
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
    summary: `Sent "${title}" to ${label}`,
  });
  await ctx.scheduler.runAfter(0, internal.broadcasts.fanOut, { broadcastId, phase: 0, cursor: null });
  return broadcastId;
}

async function deliveryOf(ctx: QueryCtx, broadcastId: Id<"broadcasts">, resolved: Resolved) {
  return resolved.kind === "user"
    ? await ctx.db
        .query("broadcastDeliveries")
        .withIndex("by_broadcastId_and_userId", (q) => q.eq("broadcastId", broadcastId).eq("userId", resolved.user._id))
        .first()
    : await ctx.db
        .query("broadcastDeliveries")
        .withIndex("by_broadcastId_and_email", (q) => q.eq("broadcastId", broadcastId).eq("email", resolved.email))
        .first();
}

/**
 * One batch of one part of the audience: a bell row for each student (pushed
 * to their devices when asked), an email for everyone when asked, a personal
 * invite when the message is one. Schedules the next batch, the next part, or
 * marks the broadcast sent.
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
  const reach = await reachOfSender(ctx, broadcast.senderId);
  const group = broadcast.groupId === undefined ? null : await ctx.db.get("groups", broadcast.groupId);
  const toPush: Id<"notifications">[] = [];
  const counts = { recipients: 0, inApp: 0, pushed: 0, emailed: 0 };
  for (const recipient of page.recipients) {
    const resolved = await resolve(ctx, recipient, reach);
    if (resolved === null) continue;
    if ((await deliveryOf(ctx, broadcast._id, resolved)) !== null) continue;
    const user = resolved.kind === "user" ? resolved.user : null;
    const student = resolved.kind === "user" && resolved.student;
    const email = resolved.kind === "address" ? resolved.email : resolved.user.email;
    const sentBy = broadcast.from[user?.locale ?? "ka"];
    const invite = group === null ? null : await openInviteFor(ctx, group._id, email, broadcast.senderId);
    const invitation = invite === null || group === null ? undefined : { groupName: group.name, url: groupInviteUrl(invite.token) };
    let notificationId: Id<"notifications"> | undefined;
    let devices = 0;
    if (user !== null && student) {
      notificationId = await ctx.db.insert("notifications", {
        userId: user._id,
        kind: "announcement",
        title: broadcast.title,
        courseTitle: sentBy,
        body: broadcast.body,
        broadcastId: broadcast._id,
        href: invite === null ? (broadcast.link ?? "/dashboard") : `/join/invite/${invite.token}`,
      });
      counts.inApp++;
      if (broadcast.channels.push) {
        devices = (
          await ctx.db
            .query("pushSubscriptions")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
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
      const sent = await sendAnnouncementEmail(
        ctx,
        user === null ? { email } : { email, user },
        // An invitation reaches someone who switched notification emails off, like one from the group's page.
        { ...broadcast, emailEveryone: broadcast.emailEveryone || invite !== null },
        sentBy,
        invitation,
      );
      emailId = sent.emailId;
      emailSkipped = sent.skipped;
      if (emailId !== undefined) counts.emailed++;
    } else {
      emailSkipped = "off";
    }
    await ctx.db.insert("broadcastDeliveries", {
      broadcastId: broadcast._id,
      userId: user?._id,
      email: user === null ? email : undefined,
      notificationId,
      devices,
      emailId,
      emailSkipped,
      inviteId: invite?._id,
    });
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
  const group = row.groupId === undefined ? null : await ctx.db.get("groups", row.groupId);
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    senderName: displayName(await ctx.db.get("users", row.senderId)),
    from: row.from,
    title: row.title,
    body: row.body,
    link: row.link,
    groupId: row.groupId,
    groupName: group?.name,
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
  userId: Id<"users"> | undefined;
  name: string;
  email: string;
  role: Role | "none";
  inApp: boolean;
  devices: number;
  emailed: boolean;
  emailSkipped: Doc<"broadcastDeliveries">["emailSkipped"];
  invited: boolean;
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
    const user = row.userId === undefined ? null : await ctx.db.get("users", row.userId);
    page.push({
      _id: row._id,
      userId: row.userId,
      name: user === null ? "" : displayName(user),
      email: user === null ? (row.email ?? "") : user.deletedAt !== undefined ? "" : user.email,
      role: user === null ? "none" : primaryRole(await getMemberships(ctx, user._id)),
      inApp: row.notificationId !== undefined,
      devices: row.devices,
      emailed: row.emailId !== undefined,
      emailSkipped: row.emailSkipped,
      invited: row.inviteId !== undefined,
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
