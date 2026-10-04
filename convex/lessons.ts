import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { requireStudent } from "./lib/auth";
import { lessonBlockInputValidator } from "./lib/validators";
import {
  addBlocks,
  createLesson,
  deleteBlock,
  deleteLesson,
  getLesson,
  getStudentLesson,
  moveLesson,
  setBlocks,
  setLessonStatus,
  staffLessonValidator,
  studentLessonValidator,
  updateBlock,
  updateLesson,
} from "./model/lessons";

// Lessons written in Kalami (model/lessons.ts): the staff app's editor, and
// the student app's reader (`read`).

export const get = query({
  args: { lessonId: v.id("lessons") },
  returns: staffLessonValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getLesson(ctx, actor, args.lessonId);
  },
});

export const create = mutation({
  args: { weekId: v.id("weeks"), title: v.string(), blocks: v.optional(v.array(lessonBlockInputValidator)) },
  returns: v.id("lessons"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await createLesson(ctx, actor, args);
  },
});

export const update = mutation({
  args: { lessonId: v.id("lessons"), title: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { lessonId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateLesson(ctx, actor, lessonId, patch);
    return null;
  },
});

/** The editor saves the whole block list at once; returns the ids the blocks ended up with. */
export const saveBlocks = mutation({
  args: { lessonId: v.id("lessons"), blocks: v.array(lessonBlockInputValidator) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await setBlocks(ctx, actor, args.lessonId, args.blocks);
  },
});

export const addBlocksTo = mutation({
  args: {
    lessonId: v.id("lessons"),
    blocks: v.array(lessonBlockInputValidator),
    position: v.optional(v.number()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await addBlocks(ctx, actor, args.lessonId, args.blocks, args.position);
  },
});

export const updateBlockIn = mutation({
  args: { lessonId: v.id("lessons"), blockId: v.string(), block: lessonBlockInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await updateBlock(ctx, actor, args.lessonId, args.blockId, args.block);
    return null;
  },
});

export const deleteBlockFrom = mutation({
  args: { lessonId: v.id("lessons"), blockId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await deleteBlock(ctx, actor, args.lessonId, args.blockId);
    return null;
  },
});

export const move = mutation({
  args: {
    lessonId: v.id("lessons"),
    direction: v.optional(v.union(v.literal("up"), v.literal("down"))),
    weekId: v.optional(v.id("weeks")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await moveLesson(ctx, actor, args.lessonId, args.weekId ? { weekId: args.weekId } : { direction: args.direction ?? "down" });
    return null;
  },
});

export const setStatus = mutation({
  args: { lessonId: v.id("lessons"), status: v.union(v.literal("draft"), v.literal("published")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await setLessonStatus(ctx, actor, args.lessonId, args.status);
    return null;
  },
});

export const remove = mutation({
  args: { lessonId: v.id("lessons") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await deleteLesson(ctx, actor, args.lessonId);
    return null;
  },
});

// --- Students ---------------------------------------------------------------------------

/** A published lesson of one of the student's courses, with the previous and next lesson. */
export const read = query({
  args: { lessonId: v.id("lessons") },
  returns: studentLessonValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getStudentLesson(ctx, student, args.lessonId);
  },
});
