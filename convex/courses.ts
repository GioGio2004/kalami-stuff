import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { enforceLimit } from "./lib/limits";
import { courseStatusValidator, localeValidator } from "./lib/validators";
import {
  courseDetailValidator,
  courseSummaryValidator,
  createCourse,
  creatableUniversities,
  getCourseDetail,
  listCoursesFor,
  regenerateJoinCode,
  setJoinEnabled,
  universityOptionValidator,
  updateCourse,
} from "./model/courses";

// Staff app (Clerk session). The same operations for AI agents live in mcp.ts.

export const listMine = query({
  args: {},
  returns: v.array(courseSummaryValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    return await listCoursesFor(ctx, actor);
  },
});

export const get = query({
  args: { courseId: v.id("courses") },
  returns: courseDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getCourseDetail(ctx, actor, args.courseId);
  },
});

/** Where the signed-in person may create a course; more than one means they must pick. */
export const universitiesForNewCourse = query({
  args: {},
  returns: v.array(universityOptionValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    return await creatableUniversities(ctx, actor);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: v.optional(localeValidator),
    // null: no university (a school class, private lessons).
    universityId: v.optional(v.union(v.id("universities"), v.null())),
  },
  returns: v.id("courses"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "createCourse", actor.user._id);
    return await createCourse(ctx, actor, args);
  },
});

export const update = mutation({
  args: {
    courseId: v.id("courses"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: v.optional(localeValidator),
    status: v.optional(courseStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, { courseId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateCourse(ctx, actor, courseId, patch);
    return null;
  },
});

export const newJoinCode = mutation({
  args: { courseId: v.id("courses") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await regenerateJoinCode(ctx, actor, args.courseId);
  },
});

export const setJoining = mutation({
  args: { courseId: v.id("courses"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await setJoinEnabled(ctx, actor, args.courseId, args.enabled);
    return null;
  },
});
