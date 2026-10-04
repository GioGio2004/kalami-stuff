import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
  groupsForCourse,
  groupSummaryValidator,
  inviteByEmail,
  invitePreviewValidator,
  inviteResultValidator,
  joinGroupByCode,
  leaveGroup,
  linkCourse,
  listGroupsFor,
  listMyGroups,
  listMyInvites,
  myGroupValidator,
  myInviteValidator,
  previewGroupByCode,
  previewInvite,
  regenerateInviteCode,
  removeMember,
  resendInvite,
  revokeInvite,
  setInviteEnabled,
  splitEmails,
  unlinkCourse,
  updateGroup,
} from "./model/groups";

// Groups: the staff app manages them, the student app joins them (model/groups.ts).

// --- Staff ------------------------------------------------------------------------------

export const listMine = query({
  args: {},
  returns: v.array(groupSummaryValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    return await listGroupsFor(ctx, actor);
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

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  returns: v.id("groups"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "createGroup", actor.user._id);
    return await createGroup(ctx, actor, args);
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
    await enforceLimit(ctx, "groupInvite", actor.user._id, Math.max(1, splitEmails(args.emails).length));
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
