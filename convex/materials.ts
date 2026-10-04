import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { enforceLimit } from "./lib/limits";
import {
  addDriveWeek,
  addLinkWeek,
  courseMaterialsValidator,
  listCourseMaterials,
  moveWeek,
  publishWeek,
  removeWeek,
  retryWeek,
  takeOverDrive,
  unpublishWeek,
  updateWeek,
} from "./model/materials";

// Course materials in the staff app (model/materials.ts). Students get the
// published weeks with their course (learn.course).

export const forCourse = query({
  // The client's clock, only to flag Drive jobs that stopped reporting back.
  args: { courseId: v.id("courses"), now: v.number() },
  returns: courseMaterialsValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await listCourseMaterials(ctx, actor, args.courseId, args.now);
  },
});

export const addLink = mutation({
  args: { courseId: v.id("courses"), title: v.string(), description: v.optional(v.string()), url: v.string() },
  returns: v.id("materials"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await addLinkWeek(ctx, actor, args);
  },
});

export const addDrive = mutation({
  args: { courseId: v.id("courses"), title: v.string(), description: v.optional(v.string()) },
  returns: v.id("materials"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    return await addDriveWeek(ctx, actor, args);
  },
});

export const update = mutation({
  args: {
    materialId: v.id("materials"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { materialId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateWeek(ctx, actor, materialId, patch);
    return null;
  },
});

export const move = mutation({
  args: { materialId: v.id("materials"), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await moveWeek(ctx, actor, args.materialId, args.direction);
    return null;
  },
});

export const publish = mutation({
  args: { materialId: v.id("materials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await publishWeek(ctx, actor, args.materialId);
    return null;
  },
});

export const unpublish = mutation({
  args: { materialId: v.id("materials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await unpublishWeek(ctx, actor, args.materialId);
    return null;
  },
});

export const remove = mutation({
  args: { materialId: v.id("materials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await removeWeek(ctx, actor, args.materialId);
    return null;
  },
});

export const retry = mutation({
  args: { materialId: v.id("materials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "drive", actor.user._id);
    await retryWeek(ctx, actor, args.materialId);
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
