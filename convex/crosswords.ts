import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { requireStudent } from "./lib/auth";
import { crosswordEntryInputValidator, publishStatusValidator } from "./lib/validators";
import {
  createCrossword,
  deleteCrossword,
  getCrossword,
  getStudentCrossword,
  moveCrossword,
  progressResultValidator,
  revealCrosswordCells,
  saveCrossword,
  saveCrosswordProgress,
  setCrosswordStatus,
  staffCrosswordValidator,
  studentCrosswordValidator,
} from "./model/crosswords";

// Crosswords (model/crosswords.ts): the staff app's editor, and the student
// app's puzzle (`read`, `saveProgress`, `reveal`).

export const get = query({
  args: { crosswordId: v.id("crosswords") },
  returns: staffCrosswordValidator,
  handler: async (ctx, args) => await getCrossword(ctx, await requireStaffActor(ctx), args.crosswordId),
});

export const create = mutation({
  args: { weekId: v.id("weeks"), title: v.string() },
  returns: v.id("crosswords"),
  handler: async (ctx, args) => await createCrossword(ctx, await requireStaffActor(ctx), args),
});

/** The editor saves the title and every word at once; returns the words' ids in order. */
export const save = mutation({
  args: { crosswordId: v.id("crosswords"), title: v.optional(v.string()), entries: v.optional(v.array(crosswordEntryInputValidator)) },
  returns: v.array(v.string()),
  handler: async (ctx, { crosswordId, ...patch }) => await saveCrossword(ctx, await requireStaffActor(ctx), crosswordId, patch),
});

/** Up or down within its week, or into another week of the course (appended). */
export const move = mutation({
  args: {
    crosswordId: v.id("crosswords"),
    direction: v.optional(v.union(v.literal("up"), v.literal("down"))),
    weekId: v.optional(v.id("weeks")),
  },
  returns: v.null(),
  handler: async (ctx, { crosswordId, direction, weekId }) => {
    const actor = await requireStaffActor(ctx);
    if (weekId !== undefined) await moveCrossword(ctx, actor, crosswordId, { weekId });
    else if (direction !== undefined) await moveCrossword(ctx, actor, crosswordId, { direction });
    return null;
  },
});

export const setStatus = mutation({
  args: { crosswordId: v.id("crosswords"), status: publishStatusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await setCrosswordStatus(ctx, await requireStaffActor(ctx), args.crosswordId, args.status);
    return null;
  },
});

export const remove = mutation({
  args: { crosswordId: v.id("crosswords") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteCrossword(ctx, await requireStaffActor(ctx), args.crosswordId);
    return null;
  },
});

// --- Students ---------------------------------------------------------------------------

/** A published crossword of one of the student's courses: the grid, the clues and their saved letters. Never the answers. */
export const read = query({
  args: { crosswordId: v.id("crosswords") },
  returns: studentCrosswordValidator,
  handler: async (ctx, args) => await getStudentCrossword(ctx, await requireStudent(ctx), args.crosswordId),
});

/** Saves their letters (one per cell, "" for empty); `check` also returns the wrong ones. */
export const saveProgress = mutation({
  args: { crosswordId: v.id("crosswords"), letters: v.array(v.string()), check: v.optional(v.boolean()) },
  returns: progressResultValidator,
  handler: async (ctx, args) =>
    await saveCrosswordProgress(ctx, await requireStudent(ctx), args.crosswordId, args.letters, args.check ?? false),
});

/** The right letters for these cells (a letter, a word or the whole grid); they count as revealed. */
export const reveal = mutation({
  args: { crosswordId: v.id("crosswords"), cells: v.array(v.number()) },
  returns: v.array(v.object({ cell: v.number(), letter: v.string() })),
  handler: async (ctx, args) => await revealCrosswordCells(ctx, await requireStudent(ctx), args.crosswordId, args.cells.slice(0, 2000)),
});
