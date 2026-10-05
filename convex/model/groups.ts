import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sendGroupInviteEmail } from "../email";
import { courseAccess, creatorUniversityIds, requireCourseEditor, type Actor } from "../lib/access";
import { getCurrentUser, getMemberships, isStaffRole, isSuperAdmin, requireIdentity } from "../lib/auth";
import { appError } from "../lib/errors";
import { normalizeEmail, optionalText, requireText } from "../lib/input";
import { enforceLimit } from "../lib/limits";
import { generateLinkToken } from "../lib/tokens";
import { courseStatusValidator, groupJoinViaValidator, localizedTextValidator } from "../lib/validators";
import { displayName, lecturerName, logAudit } from "./audit";
import { enrollThroughGroup, unenrollFromGroup } from "./enrollments";
import type { Student } from "./learn";

/**
 * Groups: a class of students. A university's groups are made and run by its
 * admins; its lecturers find them and join to teach them, each sharing their
 * own courses, so a class exists once however many lecturers it has. A teacher
 * outside any university (a school, private lessons) makes and runs private
 * groups of their own. Students join through the group's shared link or a
 * personal email invite, and every course shared with the group reaches all
 * its members (as enrollment rows, see model/enrollments.ts).
 *
 * The caps keep every change inside one mutation: sharing a course touches
 * each member once, and a new member touches each shared course once.
 */
export const MAX_MEMBERS = 500;
export const MAX_COURSES_PER_GROUP = 50;
const MAX_LECTURERS = 50;
const MAX_PENDING_INVITES = 500;
const MAX_EMAILS_PER_CALL = 100;
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_AFTER_MS = 10 * 60 * 1000;
// Read when a lecturer searches their university's groups or an admin lists them.
const MAX_GROUPS_PER_UNIVERSITY = 1000;
const MAX_SEARCH_RESULTS = 50;
// Leaving a group takes the lecturer's courses out of it in the same mutation:
// at most this many (course, student) enrollments are updated at once.
const MAX_UNSHARE_WORK = 4000;

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
  // The courses shared with the group that the viewer may see: all of them for
  // whoever runs the group, a lecturer's own for a lecturer who teaches it.
  courses: v.array(groupCourseValidator),
  // Shared by other lecturers, for a lecturer who only teaches the group.
  otherCourses: v.number(),
  lecturers: v.number(),
  universityName: v.optional(localizedTextValidator),
  // An independent teacher's own group, outside any university.
  isPrivate: v.boolean(),
  // The viewer runs the group: its university's admin, the super admin, or the owner of a private group.
  manages: v.boolean(),
  // The viewer teaches it: they joined it (or own it, for a private group).
  teaches: v.boolean(),
  updatedAt: v.number(),
});

export const groupDetailValidator = v.object({
  ...groupSummaryValidator.fields,
  // The link a lecturer who teaches the group may share; only those who run it change it.
  inviteCode: v.string(),
  ownerName: v.string(),
  // The lists below are for whoever runs the group; empty for a lecturer who only teaches it.
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
  lecturerList: v.array(
    v.object({
      userId: v.id("users"),
      name: v.string(),
      joinedAt: v.number(),
    }),
  ),
});

/** One row of a university's group list on the admin page. */
export const universityGroupValidator = v.object({
  _id: v.id("groups"),
  name: v.string(),
  description: v.optional(v.string()),
  archived: v.boolean(),
  inviteEnabled: v.boolean(),
  members: v.number(),
  lecturers: v.number(),
  courses: v.number(),
});

/** A group a lecturer can find (and join) at their university. */
export const groupSearchResultValidator = v.object({
  _id: v.id("groups"),
  name: v.string(),
  description: v.optional(v.string()),
  universityName: localizedTextValidator,
  members: v.number(),
  lecturers: v.number(),
  joined: v.boolean(),
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
  // Active groups the actor teaches that the course isn't shared with yet.
  available: v.array(v.object({ _id: v.id("groups"), name: v.string(), members: v.number() })),
});

export const groupPreviewValidator = v.object({
  groupName: v.string(),
  // Who students see the group as coming from: the university, or the teacher of a private group.
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
  // Who sent the invite.
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

/** A group name as a uniqueness key: case and spacing don't make a different group. */
export function groupNameKey(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Who runs a group: the super admin, an admin of its university or, for a
 * private group, its owner. (A group made before groups moved to admins has no
 * university yet, so its owner still runs it until it's migrated.)
 */
function managesGroup(actor: Actor, group: Doc<"groups">): boolean {
  if (isSuperAdmin(actor.memberships)) return true;
  if (group.universityId === undefined) return group.ownerId === actor.user._id;
  return actor.memberships.some((m) => m.role === "uni_admin" && m.universityId === group.universityId);
}

function administersUniversity(actor: Actor, universityId: Id<"universities">): boolean {
  return (
    isSuperAdmin(actor.memberships) ||
    actor.memberships.some((m) => m.role === "uni_admin" && m.universityId === universityId)
  );
}

/** A teacher outside any university (a school, private lessons): they run groups of their own. */
function isIndependentTeacher(actor: Actor): boolean {
  return creatorUniversityIds(actor).length === 0 && actor.memberships.some((m) => m.role === "lecturer");
}

/** The group, if the actor runs it. Everyone else gets NOT_FOUND. */
async function requireGroupManager(ctx: QueryCtx, actor: Actor, groupId: Id<"groups">) {
  const group = await ctx.db.get("groups", groupId);
  if (group === null || !managesGroup(actor, group)) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  return group;
}

/** The group, if the actor runs it or teaches it. Everyone else gets NOT_FOUND. */
async function requireGroupAccess(ctx: QueryCtx, actor: Actor, groupId: Id<"groups">) {
  const group = await ctx.db.get("groups", groupId);
  if (group === null) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  const manages = managesGroup(actor, group);
  const teaches = (await lecturerRow(ctx, groupId, actor.user._id)) !== null;
  if (!manages && !teaches) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  return { group, manages, teaches };
}

/** A university's group names are unique, so the same class can't be made twice. */
async function requireFreeName(
  ctx: QueryCtx,
  universityId: Id<"universities">,
  name: string,
  except?: Id<"groups">,
) {
  const clash = (
    await ctx.db
      .query("groups")
      .withIndex("by_universityId_and_nameKey", (q) => q.eq("universityId", universityId).eq("nameKey", groupNameKey(name)))
      .take(5)
  ).find((group) => group._id !== except);
  if (clash !== undefined) {
    throw appError(
      "CONFLICT",
      clash.archivedAt === undefined
        ? `There's already a group called “${clash.name}” at this university.`
        : `There's already a group called “${clash.name}” at this university. It's archived: restore it instead.`,
    );
  }
}

async function membersOf(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("groupMembers")
    .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
    .take(MAX_MEMBERS + 1);
}

async function lecturersOf(ctx: QueryCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("groupLecturers")
    .withIndex("by_groupId_and_userId", (q) => q.eq("groupId", groupId))
    .take(MAX_LECTURERS + 1);
}

async function lecturerRow(ctx: QueryCtx, groupId: Id<"groups">, userId: Id<"users">) {
  return await ctx.db
    .query("groupLecturers")
    .withIndex("by_groupId_and_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .unique();
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

/** Whether the actor may see a course: the super admin, its university's admin, or its staff. */
async function seesCourse(ctx: QueryCtx, actor: Actor, course: Doc<"courses">): Promise<boolean> {
  if (isSuperAdmin(actor.memberships)) return true;
  if (
    course.universityId !== undefined &&
    actor.memberships.some((m) => m.role === "uni_admin" && m.universityId === course.universityId)
  ) {
    return true;
  }
  const staff = await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", course._id).eq("userId", actor.user._id))
    .unique();
  return staff !== null;
}

async function ownsCourse(ctx: QueryCtx, courseId: Id<"courses">, userId: Id<"users">): Promise<boolean> {
  const staff = await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", courseId).eq("userId", userId))
    .unique();
  return staff?.role === "owner";
}

async function toSummary(ctx: QueryCtx, group: Doc<"groups">, actor: Actor) {
  const manages = managesGroup(actor, group);
  const [members, links, pending, lecturers, mine] = await Promise.all([
    memberCountOf(ctx, group),
    linksOf(ctx, group._id),
    pendingCountOf(ctx, group),
    lecturersOf(ctx, group._id),
    lecturerRow(ctx, group._id, actor.user._id),
  ]);
  const courses = [];
  let otherCourses = 0;
  for (const link of links) {
    const course = await ctx.db.get("courses", link.courseId);
    if (course === null) continue;
    // A lecturer who teaches the group sees their own courses in it, not their colleagues'.
    if (manages || (await seesCourse(ctx, actor, course))) {
      courses.push({ _id: course._id, title: course.title, status: course.status });
    } else {
      otherCourses++;
    }
  }
  const university = group.universityId === undefined ? null : await ctx.db.get("universities", group.universityId);
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
    otherCourses,
    lecturers: lecturers.length,
    universityName: university?.name,
    isPrivate: group.universityId === undefined,
    manages,
    teaches: mine !== null,
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

/** Who students see a group as coming from: its university, or the teacher of a private group. */
async function groupHost(ctx: QueryCtx, group: Doc<"groups">, locale: "ka" | "en"): Promise<string> {
  if (group.universityId !== undefined) {
    const university = await ctx.db.get("universities", group.universityId);
    if (university !== null) return university.name[locale];
  }
  return lecturerName(await ctx.db.get("users", group.ownerId));
}

// --- Staff ------------------------------------------------------------------------------

/** The groups the actor teaches (joined, or their own private ones), newest change first. */
export async function listGroupsFor(ctx: QueryCtx, actor: Actor) {
  const seen = new Set<Id<"groups">>();
  const out = [];
  const rows = await ctx.db
    .query("groupLecturers")
    .withIndex("by_userId", (q) => q.eq("userId", actor.user._id))
    .take(200);
  for (const row of rows) {
    const group = await ctx.db.get("groups", row.groupId);
    if (group === null || seen.has(group._id)) continue;
    seen.add(group._id);
    out.push(await toSummary(ctx, group, actor));
  }
  // Groups made before groups moved to admins still show for their owner until migrated.
  const owned = await ctx.db
    .query("groups")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", actor.user._id))
    .take(200);
  for (const group of owned) {
    if (group.nameKey !== undefined || seen.has(group._id)) continue;
    seen.add(group._id);
    out.push(await toSummary(ctx, group, actor));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Every group of a university, archived ones too, by name: for its admins. */
export async function listUniversityGroups(ctx: QueryCtx, actor: Actor, universityId: Id<"universities">) {
  if (!administersUniversity(actor, universityId)) {
    throw appError("FORBIDDEN", "Only the university's admins can see all of its groups.");
  }
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_universityId_and_nameKey", (q) => q.eq("universityId", universityId))
    .take(MAX_GROUPS_PER_UNIVERSITY);
  const out = [];
  for (const group of groups) {
    out.push({
      _id: group._id,
      name: group.name,
      description: group.description,
      archived: group.archivedAt !== undefined,
      inviteEnabled: group.inviteEnabled,
      members: await memberCountOf(ctx, group),
      lecturers: (await lecturersOf(ctx, group._id)).length,
      courses: (await linksOf(ctx, group._id)).length,
    });
  }
  return out;
}

/**
 * The groups a lecturer can find: the active groups of the universities they
 * teach at, whose names contain the query (all of them for an empty query),
 * by name. Other universities' groups and private groups never show up.
 */
export async function searchGroups(ctx: QueryCtx, actor: Actor, rawQuery: string) {
  const needle = groupNameKey(rawQuery.slice(0, 80));
  const out = [];
  for (const universityId of creatorUniversityIds(actor)) {
    const university = await ctx.db.get("universities", universityId);
    if (university === null) continue;
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_universityId_and_nameKey", (q) => q.eq("universityId", universityId))
      .take(MAX_GROUPS_PER_UNIVERSITY);
    for (const group of groups) {
      if (out.length >= MAX_SEARCH_RESULTS) break;
      if (group.archivedAt !== undefined) continue;
      if (needle !== "" && !(group.nameKey ?? groupNameKey(group.name)).includes(needle)) continue;
      out.push({
        _id: group._id,
        name: group.name,
        description: group.description,
        universityName: university.name,
        members: await memberCountOf(ctx, group),
        lecturers: (await lecturersOf(ctx, group._id)).length,
        joined: (await lecturerRow(ctx, group._id, actor.user._id)) !== null,
      });
    }
  }
  return out;
}

export async function getGroupDetail(ctx: QueryCtx, actor: Actor, groupId: Id<"groups">) {
  const { group, manages } = await requireGroupAccess(ctx, actor, groupId);
  const summary = await toSummary(ctx, group, actor);
  const memberList = [];
  const lecturerList = [];
  let inviteList: {
    _id: Id<"groupInvites">;
    email: string;
    createdAt: number;
    expiresAt: number;
    emailedAt?: number;
  }[] = [];
  // Students' names and addresses are for whoever runs the group; a lecturer
  // who teaches it meets them in their own course.
  if (manages) {
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
    inviteList = (await pendingInvitesOf(ctx, groupId)).map((invite) => ({
      _id: invite._id,
      email: invite.email,
      createdAt: invite._creationTime,
      expiresAt: invite.expiresAt,
      emailedAt: invite.emailedAt,
    }));
    for (const row of await lecturersOf(ctx, groupId)) {
      lecturerList.push({
        userId: row.userId,
        name: displayName(await ctx.db.get("users", row.userId)),
        joinedAt: row.joinedAt,
      });
    }
    lecturerList.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    ...summary,
    inviteCode: group.inviteCode,
    ownerName: displayName(await ctx.db.get("users", group.ownerId)),
    memberList,
    inviteList,
    lecturerList,
  };
}

/**
 * A university's groups are made by its admins (or the super admin), with
 * unique names; its lecturers can't make them and join them instead. A
 * teacher outside any university makes private groups of their own, and
 * teaches them.
 */
export async function createGroup(
  ctx: MutationCtx,
  actor: Actor,
  args: { name: string; description?: string; universityId?: Id<"universities"> },
): Promise<Id<"groups">> {
  const name = requireText(args.name, "Name", 80);
  const description = optionalText(args.description, "Description", 500);
  const { universityId } = args;
  if (universityId !== undefined) {
    if ((await ctx.db.get("universities", universityId)) === null) {
      throw appError("NOT_FOUND", "University not found.");
    }
    if (!administersUniversity(actor, universityId)) {
      throw appError("FORBIDDEN", "Only the university's admins can make its groups.");
    }
    await requireFreeName(ctx, universityId, name);
  } else if (!isSuperAdmin(actor.memberships) && !isIndependentTeacher(actor)) {
    throw appError(
      "FORBIDDEN",
      "Your university's admins make the groups, so each class exists once. Find yours under Groups and join it.",
    );
  }
  const now = Date.now();
  const groupId = await ctx.db.insert("groups", {
    ownerId: actor.user._id,
    universityId,
    name,
    nameKey: groupNameKey(name),
    description,
    inviteCode: await uniqueInviteCode(ctx),
    inviteEnabled: true,
    memberCount: 0,
    pendingInvites: 0,
    createdVia: actor.via,
    updatedAt: now,
  });
  if (universityId === undefined) {
    // A private group's teacher is its owner.
    await ctx.db.insert("groupLecturers", { groupId, userId: actor.user._id, joinedAt: now });
  }
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
  if (patch.name !== undefined) {
    changes.name = requireText(patch.name, "Name", 80);
    changes.nameKey = groupNameKey(changes.name);
    if (group.universityId !== undefined) {
      await requireFreeName(ctx, group.universityId, changes.name, groupId);
    }
  }
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

/** A lecturer starts teaching one of their university's groups. Joining twice is fine. */
export async function joinAsLecturer(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">): Promise<void> {
  const group = await ctx.db.get("groups", groupId);
  if (group === null || group.universityId === undefined || !creatorUniversityIds(actor).includes(group.universityId)) {
    throw appError("NOT_FOUND", "Group not found.");
  }
  if ((await lecturerRow(ctx, groupId, actor.user._id)) !== null) {
    return;
  }
  if (group.archivedAt !== undefined) {
    throw appError("CONFLICT", "This group is archived. Ask your university admin about it.");
  }
  if ((await lecturersOf(ctx, groupId)).length >= MAX_LECTURERS) {
    throw appError("CONFLICT", `This group already has ${MAX_LECTURERS} lecturers.`);
  }
  const now = Date.now();
  await ctx.db.insert("groupLecturers", { groupId, userId: actor.user._id, joinedAt: now });
  await ctx.db.patch("groups", groupId, { updatedAt: now });
  await logAudit(ctx, actor, {
    action: "group.join",
    targetTable: "groups",
    targetId: groupId,
    summary: `Started teaching group "${group.name}"`,
  });
}

/**
 * The lecturer stops teaching the group, and their courses leave it: its
 * students keep such a course only if they joined it another way. Returns how
 * many courses were unshared.
 */
export async function leaveAsLecturer(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">): Promise<number> {
  const group = await ctx.db.get("groups", groupId);
  const row = group === null ? null : await lecturerRow(ctx, groupId, actor.user._id);
  if (group === null || row === null) {
    return 0;
  }
  if (group.universityId === undefined && group.ownerId === actor.user._id) {
    throw appError("CONFLICT", "This is your own group. Archive it instead.");
  }
  const unshared = await stopTeaching(ctx, group, row);
  await logAudit(ctx, actor, {
    action: "group.leave",
    targetTable: "groups",
    targetId: groupId,
    summary: `Stopped teaching group "${group.name}"${unshared > 0 ? ` (${unshared} course${unshared === 1 ? "" : "s"} unshared)` : ""}`,
  });
  return unshared;
}

/** An admin takes a lecturer off a group; their courses leave it, as when they leave themselves. */
export async function removeLecturer(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, userId: Id<"users">) {
  const group = await requireGroupManager(ctx, actor, groupId);
  const row = await lecturerRow(ctx, groupId, userId);
  if (row === null) {
    return;
  }
  if (group.universityId === undefined && group.ownerId === userId) {
    throw appError("CONFLICT", "A private group's owner can't be removed from it.");
  }
  await stopTeaching(ctx, group, row);
  await logAudit(ctx, actor, {
    action: "group.removeLecturer",
    targetTable: "groups",
    targetId: groupId,
    summary: `Took ${displayName(await ctx.db.get("users", userId))} off group "${group.name}"`,
  });
}

/** Takes a lecturer off a group, with the courses they own or shared there. */
async function stopTeaching(ctx: MutationCtx, group: Doc<"groups">, row: Doc<"groupLecturers">): Promise<number> {
  const theirs = [];
  for (const link of await linksOf(ctx, group._id)) {
    if (link.addedBy === row.userId || (await ownsCourse(ctx, link.courseId, row.userId))) {
      theirs.push(link);
    }
  }
  const members = await membersOf(ctx, group._id);
  if (theirs.length * members.length > MAX_UNSHARE_WORK) {
    throw appError("CONFLICT", "Too many courses to take out at once. Unshare some of them from the group first.");
  }
  for (const link of theirs) {
    await ctx.db.delete("courseGroups", link._id);
    for (const member of members) {
      await unenrollFromGroup(ctx, link.courseId, member.userId, group._id);
    }
  }
  await ctx.db.delete("groupLecturers", row._id);
  await ctx.db.patch("groups", group._id, { updatedAt: Date.now() });
  return theirs.length;
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

/**
 * Shares a course with a group: every member gets it, and so will everyone who
 * joins later. The actor must edit the course and run or teach the group.
 */
export async function linkCourse(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, courseId: Id<"courses">) {
  const { group } = await requireGroupAccess(ctx, actor, groupId);
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const existing = await ctx.db
    .query("courseGroups")
    .withIndex("by_courseId_and_groupId", (q) => q.eq("courseId", courseId).eq("groupId", groupId))
    .unique();
  if (existing !== null) {
    return;
  }
  if (group.archivedAt !== undefined) {
    throw appError("CONFLICT", "This group is archived.");
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
 * Either side may do it, whoever runs the group or the course's editor: it only
 * ever narrows who sees the course.
 */
export async function unlinkCourse(ctx: MutationCtx, actor: Actor, groupId: Id<"groups">, courseId: Id<"courses">) {
  const group = await ctx.db.get("groups", groupId);
  const access = await courseAccess(ctx, actor, courseId);
  if (group === null || (!managesGroup(actor, group) && !access.canEdit)) {
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
  const available = [];
  for (const group of await listGroupsFor(ctx, actor)) {
    if (group.archived || shared.some((s) => s._id === group._id)) continue;
    available.push({ _id: group._id, name: group.name, members: group.members });
  }
  available.sort((a, b) => a.name.localeCompare(b.name));
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
    teacher: await groupHost(ctx, group, viewer?.locale ?? "en"),
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
    // A personal invite comes from the person who sent it.
    teacher: lecturerName(await ctx.db.get("users", invite.invitedBy)),
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
      teacher: lecturerName(await ctx.db.get("users", invite.invitedBy)),
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
      teacher: await groupHost(ctx, group, student.user.locale),
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

// --- Deleted accounts -------------------------------------------------------------------

/**
 * A teacher's account was deleted: their private groups (and groups not yet
 * moved to a university) stop taking anyone new (the link closes, open invites
 * are withdrawn) but keep their members, so the courses others still run on
 * them keep working. A university's groups carry on: its admins run them.
 */
export async function closeGroupsOf(ctx: MutationCtx, ownerId: Id<"users">) {
  const now = Date.now();
  const owned = await ctx.db
    .query("groups")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .take(200);
  for (const group of owned) {
    if (group.universityId !== undefined) continue;
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

/** A deleted lecturer stops teaching every group; the courses they shared stay with the students. */
export async function stopTeachingAll(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("groupLecturers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(200);
  for (const row of rows) {
    await ctx.db.delete("groupLecturers", row._id);
  }
}

/**
 * Someone no longer works at a university (moved, or lost the role): they stop
 * teaching its groups. Like a deleted lecturer, the courses they shared stay
 * with the students; the university's admins can unshare them.
 */
export async function stopTeachingAtUniversity(ctx: MutationCtx, userId: Id<"users">, universityId: Id<"universities">) {
  const rows = await ctx.db
    .query("groupLecturers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(200);
  for (const row of rows) {
    const group = await ctx.db.get("groups", row.groupId);
    if (group?.universityId === universityId) {
      await ctx.db.delete("groupLecturers", row._id);
    }
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

// --- Migration --------------------------------------------------------------------------

/**
 * One page of moving groups made before admins ran them: each goes to its
 * owner's university, and the owner keeps teaching it (a groupLecturers row),
 * with its students and courses untouched. A group whose owner has no
 * university becomes that teacher's private group. Groups already moved (they
 * have a nameKey) are skipped, so it can run again safely. Names that now clash
 * within a university are counted, for an admin to rename.
 */
export async function migrateGroupsPage(ctx: MutationCtx, cursor: string | null) {
  const page = await ctx.db.query("groups").paginate({ cursor, numItems: 100 });
  let moved = 0;
  let madePrivate = 0;
  let nameClashes = 0;
  for (const group of page.page) {
    if (group.nameKey !== undefined) continue;
    const memberships = await getMemberships(ctx, group.ownerId);
    const universityId = memberships.find((m) => isStaffRole(m.role) && m.universityId !== undefined)?.universityId;
    const nameKey = groupNameKey(group.name);
    await ctx.db.patch("groups", group._id, { universityId, nameKey });
    if ((await lecturerRow(ctx, group._id, group.ownerId)) === null) {
      await ctx.db.insert("groupLecturers", { groupId: group._id, userId: group.ownerId, joinedAt: group._creationTime });
    }
    if (universityId === undefined) {
      madePrivate++;
      continue;
    }
    moved++;
    const sameName = await ctx.db
      .query("groups")
      .withIndex("by_universityId_and_nameKey", (q) => q.eq("universityId", universityId).eq("nameKey", nameKey))
      .take(2);
    if (sameName.length > 1) nameClashes++;
  }
  return { moved, madePrivate, nameClashes, isDone: page.isDone, continueCursor: page.continueCursor };
}
