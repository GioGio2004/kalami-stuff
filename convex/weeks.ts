import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { enforceLimit } from "./lib/limits";
import { outlineValidator } from "./model/outline";
import {
  addDriveFolder,
  addLinks,
  createWeek,
  getOutline,
  moveLink,
  moveWeek,
  placeAssessment,
  publishWeek,
  removeLink,
  removeWeek,
  reorderWeeks,
  retryDrive,
  takeOverDrive,
  unpublishWeek,
  updateLink,
  updateWeek,
} from "./model/weeks";

// The course outline in the staff app (model/weeks.ts): weeks with their
// lessons, materials and placed tasks and quizzes. Lessons themselves: lessons.ts.

const linkInput = v.object({ title: v.string(), url: v.string() });

export const outline = query({
  // The client's clock, only to flag Drive jobs that stopped reporting back.
  args: { courseId: v.id("courses"), now: v.number() },
  returns: outlineValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getOutline(ctx, actor, args.courseId, args.now);
  },
});

export const create = mutation({
  args: {
    courseId: v.id("courses"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    links: v.optional(v.array(linkInput)),
    driveFolder: v.optional(v.boolean()),
  },
  returns: v.id("weeks"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    if (args.driveFolder) {
      await enforceLimit(ctx, "drive", actor.user._id);
    }
    return await createWeek(ctx, actor, args);
  },
});

export const update = mutation({
  args: { weekId: v.id("weeks"), title: v.optional(v.string()), description: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { weekId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateWeek(ctx, actor, weekId, patch);
    return null;
  },
});

export const move = mutation({
  args: { weekId: v.id("weeks"), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await moveWeek(ctx, actor, args.weekId, args.direction);
    return null;
  },
});

export const reorder = mutation({
  args: { courseId: v.id("courses"), weekIds: v.array(v.id("weeks")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await reorderWeeks(ctx, actor, args.courseId, args.weekIds);
    return null;
  },
});

export const publish = mutation({
  args: { weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await publishWeek(ctx, actor, args.weekId);
    return null;
  },
});

export const unpublish = mutation({
  args: { weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await unpublishWeek(ctx, actor, args.weekId);
    return null;
  },
});

export const remove = mutation({
  args: { weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await removeWeek(ctx, actor, args.weekId);
    return null;
  },
});

export const addLinksTo = mutation({
  args: { weekId: v.id("weeks"), links: v.array(linkInput) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await addLinks(ctx, actor, args.weekId, args.links);
  },
});

export const updateLinkIn = mutation({
  args: { weekId: v.id("weeks"), linkId: v.string(), title: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { weekId, linkId, ...input }) => {
    const actor = await requireStaffActor(ctx);
    await updateLink(ctx, actor, weekId, linkId, input);
    return null;
  },
});

export const removeLinkFrom = mutation({
  args: { weekId: v.id("weeks"), linkId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await removeLink(ctx, actor, args.weekId, args.linkId);
    return null;
  },
});

export const moveLinkIn = mutation({
  args: { weekId: v.id("weeks"), linkId: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await moveLink(ctx, actor, args.weekId, args.linkId, args.direction);
    return null;
  },
});

export const addFolder = mutation({
  args: { weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await addDriveFolder(ctx, actor, args.weekId);
    return null;
  },
});

export const retry = mutation({
  args: { weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await retryDrive(ctx, actor, args.weekId);
    return null;
  },
});

/** When the course's Drive owner is gone: new folders in the signed-in editor's Drive instead. */
export const moveToMyDrive = mutation({
  args: { courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await takeOverDrive(ctx, actor, args.courseId);
    return null;
  },
});

/** Puts a task or quiz into a week, or (weekId null) back among the unplaced. */
export const place = mutation({
  args: { assessmentId: v.id("assessments"), weekId: v.union(v.id("weeks"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await placeAssessment(ctx, actor, args.assessmentId, args.weekId);
    return null;
  },
});
