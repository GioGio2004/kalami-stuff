import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sendGroupInviteEmail } from "../email";
import { courseAccess, requireCourseEditor, type Actor } from "../lib/access";
import { getCurrentUser, isSuperAdmin, requireIdentity } from "../lib/auth";
import { appError } from "../lib/errors";
import { normalizeEmail, optionalText, requireText } from "../lib/input";
import { enforceLimit } from "../lib/limits";
import { generateLinkToken } from "../lib/tokens";
import { courseStatusValidator, groupJoinViaValidator } from "../lib/validators";
import { displayName, lecturerName, logAudit } from "./audit";
import { enrollThroughGroup, unenrollFromGroup } from "./enrollments";
import type { Student } from "./learn";

/**
 * Groups: a lecturer's class of students. Students join through the group's
 * shared link or a personal email invite, and every course shared with the
 * group reaches all its members (as enrollment rows, see model/enrollments.ts).
 *
 * The caps keep every change inside one mutation: sharing a course touches
 * each member once, and a new member touches each shared course once.
 */
export const MAX_MEMBERS = 500;
export const MAX_COURSES_PER_GROUP = 50;
const MAX_PENDING_INVITES = 500;
const MAX_EMAILS_PER_CALL = 100;
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_AFTER_MS = 10 * 60 * 1000;

// --- Validators -------------------------------------------------------------------------

const groupCourseValidator = v.object({
  _id: v.id("courses"),
  title: v.string(),
  status: courseStatusValidator,
});

export const groupSummaryValidator = v.object({
  _id: v.id("groups"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  inviteEnabled: v.boolean(),
  archived: v.boolean(),
  members: v.number(),
  pendingInvites: v.number(),
  courses: v.array(groupCourseValidator),
  updatedAt: v.number(),
});

export const groupDetailValidator = v.object({
  ...groupSummaryValidator.fields,
  inviteCode: v.string(),
  ownerName: v.string(),
  memberList: v.array(
    v.object({
      userId: v.id("users"),
      name: v.string(),
      email: v.string(),
      via: groupJoinViaValidator,
      joinedAt: v.number(),
    }),
  ),
  // Pending only: accepted invites show up as members. Expiry is the client's to
  // judge, because a query must not read the clock.
  inviteList: v.array(
    v.object({
      _id: v.id("groupInvites"),
      email: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
      emailedAt: v.optional(v.number()),
    }),
  ),
});

export const inviteResultValidator = v.object({
  invited: v.array(v.string()),
  // Emails actually queued; fewer than `invited` when sending isn't configured.
  emailed: v.number(),
  alreadyMembers: v.array(v.string()),
  alreadyInvited: v.array(v.string()),
  invalid: v.array(v.string()),
});

export const courseGroupsValidator = v.object({
  shared: v.array(v.object({ _id: v.id("groups"), name: v.string(), members: v.number(), archived: v.boolean() })),
  // The actor's own active groups the course isn't shared with yet.
  available: v.array(v.object({ _id: v.id("groups"), name: v.string(), members: v.number() })),
});

export const groupPreviewValidator = v.object({
  groupName: v.string(),
  teacher: v.string(),
  courseCount: v.number(),
  // Whether the signed-in person (if any) is already in the group.
  alreadyMember: v.boolean(),
});

export const invitePreviewValidator = v.object({
  ...groupPreviewValidator.fields,
  email: v.string(),
  status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
  expiresAt: v.number(),
});

export const myInviteValidator = v.object({
  token: v.string(),
  groupName: v.string(),
  teacher: v.string(),
  expiresAt: v.number(),
});

export const myGroupValidator = v.object({
  _id: v.id("groups"),
  name: v.string(),
  teacher: v.string(),
  joinedAt: v.number(),
});

// --- Shared helpers ---------------------------------------------------------------------

/** The group, if the actor owns it (or is the super admin). Everyone else gets NOT_FOUND. */
async function requireGroupManager(ctx: QueryCtx, actor: Actor, groupId: Id<"groups">) {
  const group = await ctx.db.get("groups", groupId);
  if (group === null || (group.ownerId !== actor.user._id && !isSuperAdmin(actor.memberships))) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  return group;
}

async function membersOf(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("groupMembers")
    .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
    .take(MAX_MEMBERS + 1);
}

async function linksOf(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("courseGroups")
    .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
    .take(MAX_COURSES_PER_GROUP + 1);
}

/** Open invites (not accepted, not withdrawn), newest first. Expired ones included: the page marks them. */
async function pendingInvitesOf(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("groupInvites")
    .withIndex("by_groupId_and_acceptedAt_and_revokedAt", (q) =>
      q.eq("groupId", groupId).eq("acceptedAt", undefined).eq("revokedAt", undefined),
    )
    .order("desc")
    .take(MAX_PENDING_INVITES);
}

// The counts live on the group row, so a join reads one document instead of
// every member (150 students opening the link at once mustn't trip over each
// other). Rows from before the counts existed are counted once, the slow way.
async function memberCountOf(ctx: QueryCtx, group: Doc<"groups">) {
  return group.memberCount ?? (await membersOf(ctx, group._id)).length;
}

async function pendingCountOf(ctx: QueryCtx, group: Doc<"groups">) {
  return group.pendingInvites ?? (await pendingInvitesOf(ctx, group._id)).length;
}

async function membership(ctx: QueryCtx, groupId: Id<"groups">, userId: Id<"users">) {
  return await ctx.db
    .query("groupMembers")
    .withIndex("by_groupId_and_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .unique();
}

async function uniqueInviteCode(ctx: QueryCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateLinkToken();
    const taken = await ctx.db
      .query("groups")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
      .unique();
    if (taken === null) {
      return code;
    }
  }
  throw new Error("Could not find a free invite code");
}

async function toSummary(ctx: QueryCtx, group: Doc<"groups">) {
  const [members, links, pending] = await Promise.all([
    memberCountOf(ctx, group),
    linksOf(ctx, group._id),
    pendingCountOf(ctx, group),
  ]);
  const courses = [];
  for (const link of links) {
    const course = await ctx.db.get("courses", link.courseId);
    if (course !== null) {
      courses.push({ _id: course._id, title: course.title, status: course.status });
    }
  }
  return {
    _id: group._id,
    _creationTime: group._creationTime,
    name: group.name,
    description: group.description,
    inviteEnabled: group.inviteEnabled,
    archived: group.archivedAt !== undefined,
    members,
    pendingInvites: pending,
    courses,
    updatedAt: group.updatedAt,
  };
}

/** Adds the student and gives them every course shared with the group. */
async function addMember(
  ctx: MutationCtx,
  group: Doc<"groups">,
  userId: Id<"users">,
  via: "link" | "email",
): Promise<boolean> {
  if ((await membership(ctx, group._id, userId)) !== null) {
    return false;
  }
  const count = await memberCountOf(ctx, group);
  if (count >= MAX_MEMBERS) {
    throw appError("CONFLICT", `This group is full (${MAX_MEMBERS} students). Ask your teacher.`);
  }
  await ctx.db.insert("groupMembers", { groupId: group._id, userId, via, joinedAt: Date.now() });
  await ctx.db.patch("groups", group._id, { memberCount: count + 1 });
  for (const link of await linksOf(ctx, group._id)) {
    await enrollThroughGroup(ctx, link.courseId, userId, group._id);
  }
  return true;
}

// --- Staff ------------------------------------------------------------------------------

/** The actor's own groups, newest change first. */
export async function listGroupsFor(ctx: QueryCtx, actor: Actor) {
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", actor.user._id))
    .take(200);
  const out = [];
  for (const group of groups) {
    out.push(await toSummary(ctx, group));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function getGroupDetail(ctx: QueryCtx, actor: Actor, groupId: Id<"groups">) {
  const group = await requireGroupManager(ctx, actor, groupId);
  const summary = await toSummary(ctx, group);
  const memberList = [];
  for (const member of await membersOf(ctx, groupId)) {
    const user = await ctx.db.get("users", member.userId);
    memberList.push({
      userId: member.userId,
      name: displayName(user),
      email: user === null || user.deletedAt !== undefined ? "" : user.email,
      via: member.via,
      joinedAt: member.joinedAt,
    });
  }
  memberList.sort((a, b) => a.name.localeCompare(b.name));
  const inviteList = (await pendingInvitesOf(ctx, groupId)).map((invite) => ({
    _id: invite._id,
    email: invite.email,
    createdAt: invite._creationTime,
    expiresAt: invite.expiresAt,
    emailedAt: invite.emailedAt,
  }));
  return {
    ...summary,
    inviteCode: group.inviteCode,
    ownerName: displayName(await ctx.db.get("users", group.ownerId)),
    memberList,
    inviteList,
  };
}

export async function createGroup(
  ctx: MutationCtx,
  actor: Actor,
  args: { name: string; description?: string },
): Promise<Id<"groups">> {
  const name = requireText(args.name, "Name", 80);
  const description = optionalText(args.description, "Description", 500);
  const groupId = await ctx.db.insert("groups", {
    ownerId: actor.user._id,
    name,
    description,
    inviteCode: await uniqueInviteCode(ctx),
    inviteEnabled: true,
    memberCount: 0,
    pendingInvites: 0,
    createdVia: actor.via,
    updatedAt: Date.now(),
  });
  await logAudit(ctx, actor, {
    action: "group.create",
    targetTable: "groups",
    targetId: groupId,
    summary: `Created group "${name}"`,
  });
  return groupId;
}

export async function updateGroup(
  ctx: MutationCtx,
  actor: Actor,
  groupId: Id<"groups">,
  patch: { name?: string; description?: string; archived?: boolean },
): Promise<void> {
  const group = await requireGroupManager(ctx, actor, groupId);
  const changes: Partial<Doc<"groups">> = {};
  if (patch.name !== undefined) changes.name = requireText(patch.name, "Name", 80);
  if (patch.description !== undefined) {
    changes.description = optionalText(patch.description, "Description", 500);
  }
  if (patch.archived !== undefined) {
    // An archived group keeps its members and their courses; it just takes no one new.
    changes.archivedAt = patch.archived ? (group.archivedAt ?? Date.now()) : undefined;
  }
  await ctx.db.patch("groups", groupId, { ...changes, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "group.update",
    targetTable: "groups",
    targetId: groupId,
    summary: `Updated ${Object.keys(changes).join(", ") || "nothing"} on group "${changes.name ?? group.name}"`,
  });
}

/** A new link; the old one stops working at once. */
export async function regenerateInviteCode(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">) {
  const group = await requireGroupManager(ctx, actor, groupId);
  const inviteCode = await uniqueInviteCode(ctx);
  await ctx.db.patch("groups", groupId, { inviteCode, inviteEnabled: true, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "group.inviteCode",
    targetTable: "groups",
    targetId: groupId,
    summary: `New invite link for group "${group.name}"`,
  });
  return inviteCode;
}

export async function setInviteEnabled(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, enabled: boolean) {
  const group = await requireGroupManager(ctx, actor, groupId);
  await ctx.db.patch("groups", groupId, { inviteEnabled: enabled, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "group.inviteEnabled",
    targetTable: "groups",
    targetId: groupId,
    summary: `${enabled ? "Opened" : "Closed"} the invite link of group "${group.name}"`,
  });
}

/** Splits a pasted list (commas, semicolons, spaces, new lines) into addresses. */
export function splitEmails(raw: string[]): string[] {
  return raw.flatMap((entry) => entry.split(/[\s,;]+/)).map((email) => email.trim()).filter((email) => email !== "");
}

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Personal invites, one per address, each emailed. Addresses already in the
 * group or already invited are reported back, not invited twice; bad ones are
 * listed rather than failing the whole paste.
 */
export async function inviteByEmail(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, rawEmails: string[]) {
  const group = await requireGroupManager(ctx, actor, groupId);
  if (group.archivedAt !== undefined) {
    throw appError("CONFLICT", "This group is archived. Restore it to invite students.");
  }
  const result = {
    invited: [] as string[],
    emailed: 0,
    alreadyMembers: [] as string[],
    alreadyInvited: [] as string[],
    invalid: [] as string[],
  };
  const emails: string[] = [];
  for (const raw of splitEmails(rawEmails)) {
    const email = normalizeEmail(raw);
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      result.invalid.push(raw);
    } else if (!emails.includes(email)) {
      emails.push(email);
    }
  }
  if (emails.length > MAX_EMAILS_PER_CALL) {
    throw appError("INVALID_INPUT", `Invite at most ${MAX_EMAILS_PER_CALL} addresses at a time.`);
  }
  const now = Date.now();
  const fresh: string[] = [];
  for (const email of emails) {
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(5);
    let member = false;
    for (const user of users) {
      if ((await membership(ctx, groupId, user._id)) !== null) member = true;
    }
    if (member) {
      result.alreadyMembers.push(email);
      continue;
    }
    const earlier = await ctx.db
      .query("groupInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(50);
    if (
      earlier.some(
        (invite) =>
          invite.groupId === groupId &&
          invite.acceptedAt === undefined &&
          invite.revokedAt === undefined &&
          invite.expiresAt > now,
      )
    ) {
      result.alreadyInvited.push(email);
      continue;
    }
    fresh.push(email);
  }
  if (fresh.length === 0) {
    return result;
  }
  const pendingCount = await pendingCountOf(ctx, group);
  if (pendingCount + fresh.length > MAX_PENDING_INVITES) {
    throw appError("CONFLICT", "Too many invites are waiting. Withdraw old ones first.");
  }
  // Counted after cleaning up the paste: names, duplicates and bad addresses cost nothing.
  await enforceLimit(ctx, "groupInvite", actor.user._id, fresh.length);
  const inviter = lecturerName(actor.user);
  for (const email of fresh) {
    const token = generateLinkToken();
    const inviteId = await ctx.db.insert("groupInvites", {
      groupId,
      email,
      token,
      invitedBy: actor.user._id,
      expiresAt: now + INVITE_TTL_MS,
    });
    result.invited.push(email);
    if (await sendGroupInviteEmail(ctx, { _id: inviteId, email, token }, { inviterName: inviter, groupName: group.name })) {
      result.emailed++;
    }
  }
  if (result.invited.length > 0) {
    await ctx.db.patch("groups", groupId, { updatedAt: now, pendingInvites: pendingCount + result.invited.length });
    await logAudit(ctx, actor, {
      action: "group.invite",
      targetTable: "groups",
      targetId: groupId,
      summary: `Invited ${result.invited.length} student${result.invited.length === 1 ? "" : "s"} to group "${group.name}"`,
    });
  }
  return result;
}

async function requireManagedInvite(ctx: QueryCtx, actor: Actor, inviteId: Id<"groupInvites">) {
  const invite = await ctx.db.get("groupInvites", inviteId);
  if (invite === null) {
    throw appError("NOT_FOUND", "Invite not found.");
  }
  const group = await requireGroupManager(ctx, actor, invite.groupId);
  return { invite, group };
}

/** Sends the email again and gives the invite a fresh month. */
export async function resendInvite(ctx: MutationCtx, actor: Actor, inviteId: Id<"groupInvites">): Promise<boolean> {
  const { invite, group } = await requireManagedInvite(ctx, actor, inviteId);
  if (invite.acceptedAt !== undefined || invite.revokedAt !== undefined) {
    throw appError("CONFLICT", "This invite is no longer open.");
  }
  const now = Date.now();
  if (invite.emailedAt !== undefined && now - invite.emailedAt < RESEND_AFTER_MS) {
    throw appError("CONFLICT", "It was emailed a few minutes ago. Give it a little time to arrive.");
  }
  await ctx.db.patch("groupInvites", invite._id, { expiresAt: now + INVITE_TTL_MS });
  return await sendGroupInviteEmail(ctx, invite, { inviterName: lecturerName(actor.user), groupName: group.name });
}

export async function revokeInvite(ctx: MutationCtx, actor: Actor, inviteId: Id<"groupInvites">) {
  const { invite, group } = await requireManagedInvite(ctx, actor, inviteId);
  if (invite.acceptedAt !== undefined) {
    throw appError("CONFLICT", "This invite was already accepted. Remove the student instead.");
  }
  if (invite.revokedAt === undefined) {
    const pending = await pendingCountOf(ctx, group);
    await ctx.db.patch("groupInvites", invite._id, { revokedAt: Date.now() });
    await ctx.db.patch("groups", group._id, { pendingInvites: Math.max(0, pending - 1) });
  }
}

/** Takes the student out of the group and out of every course they had only through it. */
export async function removeMember(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, userId: Id<"users">) {
  const group = await requireGroupManager(ctx, actor, groupId);
  const row = await membership(ctx, groupId, userId);
  if (row === null) {
    return;
  }
  await leave(ctx, group, row);
  await logAudit(ctx, actor, {
    action: "group.removeMember",
    targetTable: "groups",
    targetId: groupId,
    summary: `Removed ${displayName(await ctx.db.get("users", userId))} from group "${group.name}"`,
  });
}

async function leave(ctx: MutationCtx, group: Doc<"groups">, row: Doc<"groupMembers">) {
  const count = await memberCountOf(ctx, group);
  await ctx.db.delete("groupMembers", row._id);
  await ctx.db.patch("groups", group._id, { memberCount: Math.max(0, count - 1) });
  for (const link of await linksOf(ctx, group._id)) {
    await unenrollFromGroup(ctx, link.courseId, row.userId, group._id);
  }
}

/** Shares a course with a group: every member gets it, and so will everyone who joins later. */
export async function linkCourse(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, courseId: Id<"courses">) {
  const group = await requireGroupManager(ctx, actor, groupId);
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const existing = await ctx.db
    .query("courseGroups")
    .withIndex("by_courseId_and_groupId", (q) => q.eq("courseId", courseId).eq("groupId", groupId))
    .unique();
  if (existing !== null) {
    return;
  }
  if ((await linksOf(ctx, groupId)).length >= MAX_COURSES_PER_GROUP) {
    throw appError("CONFLICT", `A group can have at most ${MAX_COURSES_PER_GROUP} courses.`);
  }
  await ctx.db.insert("courseGroups", { courseId, groupId, addedBy: actor.user._id, addedAt: Date.now() });
  for (const member of await membersOf(ctx, groupId)) {
    await enrollThroughGroup(ctx, courseId, member.userId, groupId);
  }
  await ctx.db.patch("groups", groupId, { updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "group.linkCourse",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Shared "${course.title}" with group "${group.name}"`,
  });
}

/**
 * Stops sharing; members keep the course only if they joined it another way.
 * Either side may do it, the group's manager or the course's editor: it only
 * ever narrows who sees the course.
 */
export async function unlinkCourse(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, courseId: Id<"courses">) {
  const group = await ctx.db.get("groups", groupId);
  const access = await courseAccess(ctx, actor, courseId);
  const managesGroup = group !== null && (group.ownerId === actor.user._id || isSuperAdmin(actor.memberships));
  if (group === null || (!managesGroup && !access.canEdit)) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  const { course } = access;
  const existing = await ctx.db
    .query("courseGroups")
    .withIndex("by_courseId_and_groupId", (q) => q.eq("courseId", courseId).eq("groupId", groupId))
    .unique();
  if (existing === null) {
    return;
  }
  await ctx.db.delete("courseGroups", existing._id);
  for (const member of await membersOf(ctx, groupId)) {
    await unenrollFromGroup(ctx, courseId, member.userId, groupId);
  }
  await ctx.db.patch("groups", groupId, { updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "group.unlinkCourse",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Stopped sharing "${course.title}" with group "${group.name}"`,
  });
}

/** For a course page: the groups it's shared with, and the actor's other groups it could be. */
export async function groupsForCourse(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">) {
  await requireCourseEditor(ctx, actor, courseId);
  const links = await ctx.db
    .query("courseGroups")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(200);
  const shared = [];
  for (const link of links) {
    const group = await ctx.db.get("groups", link.groupId);
    if (group !== null) {
      shared.push({
        _id: group._id,
        name: group.name,
        members: await memberCountOf(ctx, group),
        archived: group.archivedAt !== undefined,
      });
    }
  }
  const own = await ctx.db
    .query("groups")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", actor.user._id))
    .take(200);
  const available = [];
  for (const group of own) {
    if (group.archivedAt !== undefined || shared.some((s) => s._id === group._id)) continue;
    available.push({ _id: group._id, name: group.name, members: await memberCountOf(ctx, group) });
  }
  return { shared, available };
}

// --- Students ---------------------------------------------------------------------------

async function openGroupByCode(ctx: QueryCtx, rawCode: string) {
  const code = rawCode.trim();
  if (code.length < 8 || code.length > 64) {
    return null;
  }
  const group = await ctx.db
    .query("groups")
    .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
    .unique();
  if (group === null || !group.inviteEnabled || group.archivedAt !== undefined) {
    return null;
  }
  return group;
}

async function preview(ctx: QueryCtx, group: Doc<"groups">) {
  const viewer = await getCurrentUser(ctx);
  return {
    groupName: group.name,
    teacher: lecturerName(await ctx.db.get("users", group.ownerId)),
    courseCount: (await linksOf(ctx, group._id)).length,
    alreadyMember: viewer !== null && (await membership(ctx, group._id, viewer._id)) !== null,
  };
}

/**
 * Deliberately public: people open the link before they have an account. The
 * unguessable code is the secret; joining still needs a signed-in student.
 * A closed link, an archived group and a wrong code all look the same.
 */
export async function previewGroupByCode(ctx: QueryCtx, code: string) {
  const group = await openGroupByCode(ctx, code);
  return group === null ? null : await preview(ctx, group);
}

export async function joinGroupByCode(ctx: MutationCtx, student: Student, code: string) {
  const group = await openGroupByCode(ctx, code);
  if (group === null) {
    throw appError("NOT_FOUND", "This invite link doesn't work any more. Ask your teacher for a new one.");
  }
  await addMember(ctx, group, student.user._id, "link");
  return group._id;
}

async function inviteByToken(ctx: QueryCtx, token: string) {
  if (token.length < 8 || token.length > 64) {
    return null;
  }
  return await ctx.db
    .query("groupInvites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

/** Public, like the group link: the invitee opens it from the email, maybe before signing up. */
export async function previewInvite(ctx: QueryCtx, token: string) {
  const invite = await inviteByToken(ctx, token);
  const group = invite === null ? null : await ctx.db.get("groups", invite.groupId);
  if (invite === null || group === null) {
    return null;
  }
  return {
    ...(await preview(ctx, group)),
    email: invite.email,
    status:
      invite.revokedAt !== undefined || group.archivedAt !== undefined
        ? ("revoked" as const)
        : invite.acceptedAt !== undefined
          ? ("accepted" as const)
          : ("pending" as const),
    expiresAt: invite.expiresAt,
  };
}

/**
 * Only the account with the invited, verified email can accept, so a
 * forwarded email doesn't let someone else in. (The group link is the open way.)
 */
export async function acceptInvite(ctx: MutationCtx, student: Student, token: string) {
  const invite = await inviteByToken(ctx, token);
  const group = invite === null ? null : await ctx.db.get("groups", invite.groupId);
  if (invite === null || group === null || invite.revokedAt !== undefined || group.archivedAt !== undefined) {
    throw appError("NOT_FOUND", "This invite doesn't exist or was withdrawn.");
  }
  if (invite.acceptedAt !== undefined) {
    if (invite.acceptedBy === student.user._id) {
      return group._id;
    }
    throw appError("CONFLICT", "This invite has already been used.");
  }
  if (invite.expiresAt < Date.now()) {
    throw appError("EXPIRED", "This invite has expired. Ask your teacher to send it again.");
  }
  if (student.user.email !== invite.email) {
    throw appError(
      "FORBIDDEN",
      `This invite is for ${invite.email}, but you're signed in as ${student.user.email}. Sign in with that address, or ask your teacher for the group link.`,
    );
  }
  const identity = await requireIdentity(ctx);
  if (identity.emailVerified !== true) {
    throw appError("FORBIDDEN", "Verify your email address first.");
  }
  const pending = await pendingCountOf(ctx, group);
  await addMember(ctx, group, student.user._id, "email");
  await ctx.db.patch("groupInvites", invite._id, { acceptedAt: Date.now(), acceptedBy: student.user._id });
  await ctx.db.patch("groups", group._id, { pendingInvites: Math.max(0, pending - 1) });
  return group._id;
}

/** Open invites to the student's own address, for the dashboard. Expired ones are the client's to hide. */
export async function listMyInvites(ctx: QueryCtx, student: Student) {
  const invites = await ctx.db
    .query("groupInvites")
    .withIndex("by_email", (q) => q.eq("email", student.user.email))
    .order("desc")
    .take(50);
  const out = [];
  for (const invite of invites) {
    if (invite.acceptedAt !== undefined || invite.revokedAt !== undefined) continue;
    const group = await ctx.db.get("groups", invite.groupId);
    if (group === null || group.archivedAt !== undefined) continue;
    if ((await membership(ctx, group._id, student.user._id)) !== null) continue;
    out.push({
      token: invite.token,
      groupName: group.name,
      teacher: lecturerName(await ctx.db.get("users", group.ownerId)),
      expiresAt: invite.expiresAt,
    });
  }
  return out;
}

export async function listMyGroups(ctx: QueryCtx, student: Student) {
  const rows = await ctx.db
    .query("groupMembers")
    .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
    .take(100);
  const out = [];
  for (const row of rows) {
    const group = await ctx.db.get("groups", row.groupId);
    if (group === null) continue;
    out.push({
      _id: group._id,
      name: group.name,
      teacher: lecturerName(await ctx.db.get("users", group.ownerId)),
      joinedAt: row.joinedAt,
    });
  }
  return out;
}

export async function leaveGroup(ctx: MutationCtx, student: Student, groupId: Id<"groups">) {
  const group = await ctx.db.get("groups", groupId);
  const row = group === null ? null : await membership(ctx, groupId, student.user._id);
  if (group === null || row === null) {
    return;
  }
  await leave(ctx, group, row);
}

/**
 * A teacher's account was deleted: their groups stop taking anyone new (the
 * link closes, open invites are withdrawn) but keep their members, so the
 * courses others still run on them keep working.
 */
export async function closeGroupsOf(ctx: MutationCtx, ownerId: Id<"users">) {
  const now = Date.now();
  const owned = await ctx.db
    .query("groups")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .take(200);
  for (const group of owned) {
    for (const invite of await pendingInvitesOf(ctx, group._id)) {
      await ctx.db.patch("groupInvites", invite._id, { revokedAt: now });
    }
    await ctx.db.patch("groups", group._id, {
      inviteEnabled: false,
      archivedAt: group.archivedAt ?? now,
      pendingInvites: 0,
      updatedAt: now,
    });
  }
}

/** A deleted account leaves every group; their enrollments are handled by the caller. */
export async function leaveAllGroups(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("groupMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(200);
  for (const row of rows) {
    const group = await ctx.db.get("groups", row.groupId);
    const count = group === null ? 0 : await memberCountOf(ctx, group);
    await ctx.db.delete("groupMembers", row._id);
    if (group !== null) {
      await ctx.db.patch("groups", group._id, { memberCount: Math.max(0, count - 1) });
    }
  }
}
