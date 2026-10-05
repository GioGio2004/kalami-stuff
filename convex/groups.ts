import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { requireStudent } from "./lib/auth";
import { enforceLimit } from "./lib/limits";
import {
  acceptInvite,
  courseGroupsValidator,
  createGroup,
  getGroupDetail,
  groupDetailValidator,
  groupPreviewValidator,
  groupSearchResultValidator,
  groupsForCourse,
  groupSummaryValidator,
  inviteByEmail,
  invitePreviewValidator,
  inviteResultValidator,
  joinAsLecturer as startTeaching,
  joinGroupByCode,
  leaveAsLecturer as stopTeachingGroup,
  leaveGroup,
  linkCourse,
  listGroupsFor,
  listMyGroups,
  listMyInvites,
  listUniversityGroups,
  migrateGroupsPage,
  myGroupValidator,
  myInviteValidator,
  previewGroupByCode,
  previewInvite,
  regenerateInviteCode,
  removeLecturer as takeLecturerOff,
  removeMember,
  resendInvite,
  revokeInvite,
  searchGroups,
  setInviteEnabled,
  universityGroupValidator,
  unlinkCourse,
  updateGroup,
} from "./model/groups";

// Groups: university admins make and run them, lecturers join them to teach,
// independent teachers run their own; the student app joins them (model/groups.ts).

// --- Staff ------------------------------------------------------------------------------

/** The groups the signed-in lecturer teaches. */
export const listMine = query({
  args: {},
  returns: v.array(groupSummaryValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    return await listGroupsFor(ctx, actor);
  },
});

/** Every group of a university, for the admin page. */
export const forUniversity = query({
  args: { universityId: v.id("universities") },
  returns: v.array(universityGroupValidator),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await listUniversityGroups(ctx, actor, args.universityId);
  },
});

/** A lecturer looking for their group at their university. An empty query lists them all. */
export const search = query({
  args: { query: v.string() },
  returns: v.array(groupSearchResultValidator),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await searchGroups(ctx, actor, args.query);
  },
});

export const get = query({
  args: { groupId: v.id("groups") },
  returns: groupDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getGroupDetail(ctx, actor, args.groupId);
  },
});

/** With `universityId`: a university admin's group. Without: an independent teacher's private group. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    universityId: v.optional(v.id("universities")),
  },
  returns: v.id("groups"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "createGroup", actor.user._id);
    return await createGroup(ctx, actor, args);
  },
});

/** A lecturer starts teaching one of their university's groups. */
export const joinAsLecturer = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "join", actor.user._id);
    await startTeaching(ctx, actor, args.groupId);
    return null;
  },
});

/** A lecturer stops teaching a group; returns how many of their courses left it. */
export const leaveAsLecturer = mutation({
  args: { groupId: v.id("groups") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await stopTeachingGroup(ctx, actor, args.groupId);
  },
});

export const removeLecturer = mutation({
  args: { groupId: v.id("groups"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await takeLecturerOff(ctx, actor, args.groupId, args.userId);
    return null;
  },
});

export const update = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { groupId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateGroup(ctx, actor, groupId, patch);
    return null;
  },
});

export const newInviteLink = mutation({
  args: { groupId: v.id("groups") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await regenerateInviteCode(ctx, actor, args.groupId);
  },
});

export const setInviteLink = mutation({
  args: { groupId: v.id("groups"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await setInviteEnabled(ctx, actor, args.groupId, args.enabled);
    return null;
  },
});

/** `emails` may be one pasted block or many entries; commas, spaces and new lines all separate. */
export const invite = mutation({
  args: { groupId: v.id("groups"), emails: v.array(v.string()) },
  returns: inviteResultValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    // The rate limit is applied inside, to the addresses actually invited.
    return await inviteByEmail(ctx, actor, args.groupId, args.emails);
  },
});

/** True when an email was queued (false when sending isn't configured on this deployment). */
export const resendInviteEmail = mutation({
  args: { inviteId: v.id("groupInvites") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "groupInvite", actor.user._id);
    return await resendInvite(ctx, actor, args.inviteId);
  },
});

export const withdrawInvite = mutation({
  args: { inviteId: v.id("groupInvites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await revokeInvite(ctx, actor, args.inviteId);
    return null;
  },
});

export const removeStudent = mutation({
  args: { groupId: v.id("groups"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await removeMember(ctx, actor, args.groupId, args.userId);
    return null;
  },
});

export const shareCourse = mutation({
  args: { groupId: v.id("groups"), courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await linkCourse(ctx, actor, args.groupId, args.courseId);
    return null;
  },
});

export const unshareCourse = mutation({
  args: { groupId: v.id("groups"), courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await unlinkCourse(ctx, actor, args.groupId, args.courseId);
    return null;
  },
});

export const forCourse = query({
  args: { courseId: v.id("courses") },
  returns: courseGroupsValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await groupsForCourse(ctx, actor, args.courseId);
  },
});

// --- Students ---------------------------------------------------------------------------

/** Public: the join page shows who invited you before you sign in. Null for a dead link. */
export const preview = query({
  args: { code: v.string() },
  returns: v.union(v.null(), groupPreviewValidator),
  handler: async (ctx, args) => await previewGroupByCode(ctx, args.code),
});

export const join = mutation({
  args: { code: v.string() },
  returns: v.id("groups"),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "join", student.user._id);
    return await joinGroupByCode(ctx, student, args.code);
  },
});

/** Public, for the page a personal invite email opens. */
export const previewEmailInvite = query({
  args: { token: v.string() },
  returns: v.union(v.null(), invitePreviewValidator),
  handler: async (ctx, args) => await previewInvite(ctx, args.token),
});

export const acceptEmailInvite = mutation({
  args: { token: v.string() },
  returns: v.id("groups"),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "join", student.user._id);
    return await acceptInvite(ctx, student, args.token);
  },
});

export const myInvites = query({
  args: {},
  returns: v.array(myInviteValidator),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await listMyInvites(ctx, student);
  },
});

export const mine = query({
  args: {},
  returns: v.array(myGroupValidator),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await listMyGroups(ctx, student);
  },
});

export const leave = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await leaveGroup(ctx, student, args.groupId);
    return null;
  },
});

// --- Migration --------------------------------------------------------------------------

/**
 * Moves groups made before admins ran them into their owner's university (see
 * migrateGroupsPage). Run once per deployment after deploying:
 * `npx convex run groups:migrateToUniversityGroups '{"cursor":null}'` (add --prod
 * for production). Each page schedules the next; safe to run again.
 */
export const migrateToUniversityGroups = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ moved: v.number(), madePrivate: v.number(), nameClashes: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const { continueCursor, ...result } = await migrateGroupsPage(ctx, args.cursor);
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.groups.migrateToUniversityGroups, { cursor: continueCursor });
    }
    if (result.moved + result.madePrivate > 0) {
      console.log(`groups migration: ${JSON.stringify(result)}`);
    }
    return result;
  },
});
