import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, type Actor } from "../lib/access";
import {
  arrangeCrossword,
  CROSSWORD_ENTRY_ID,
  CROSSWORD_LIMITS,
  crosswordGrid,
  crosswordProblems,
  crosswordVersion,
  normalizeLetter,
  tidyEntry,
  type CrosswordEntry,
} from "../lib/crossword";
import { appError } from "../lib/errors";
import { actorHas, requireFeature } from "../lib/features";
import { requireText } from "../lib/input";
import { enforceLimit } from "../lib/limits";
import {
  crosswordEntryValidator,
  crosswordLayoutValidator,
  publishStatusValidator,
  type CrosswordEntryInput,
} from "../lib/validators";
import { logAudit } from "./audit";
import type { Student } from "./learn";
import { crosswordsOf } from "./weeks";

/**
 * Crosswords: practice puzzles inside a week, next to its lessons and
 * presentations. A crossword is a title and a list of words with clues; the
 * grid is laid out from the words by lib/crossword (deterministic: the same
 * words always give the same grid), so neither people nor agents place
 * anything. Only people with the "crosswords" feature make or change them
 * (lib/features.ts); unpublishing and deleting stay open to the course's
 * editors so they can always tidy up. Agents only touch drafts.
 *
 * Students fill them in on the student app. The answers never leave the
 * server: checking, revealing and "solved" are worked out here.
 */

const MAX_CROSSWORDS_PER_WEEK = 20;

/** What a new crossword from the editor starts with, for the teacher to replace. */
const STARTER: CrosswordEntryInput[] = [
  { answer: "Crossword", clue: "This puzzle" },
  { answer: "Word", clue: "Write one in each row or column" },
  { answer: "Clue", clue: "A hint for a word" },
  { answer: "Grid", clue: "Where the letters go" },
];

function entryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tidies and checks the words, keeps the ids they came with (new ones get
 * one) and lays out the grid: words put in place by hand (`at`) stay there,
 * the rest are fitted around them; without any, Kalami lays out everything.
 * Every problem is reported at once, words that don't fit included.
 */
export function buildCrossword(inputs: CrosswordEntryInput[]) {
  const taken = new Set<string>();
  const placed = inputs.map((input) => {
    const id = input.id && CROSSWORD_ENTRY_ID.test(input.id) && !taken.has(input.id) ? input.id : entryId();
    taken.add(id);
    return { ...tidyEntry({ id, answer: input.answer, clue: input.clue }), at: input.at };
  });
  const entries: CrosswordEntry[] = placed.map(({ id, answer, clue }) => ({ id, answer, clue }));
  const { clashes, ...layout } = arrangeCrossword(placed);
  const problems = crosswordProblems(placed, { ...layout, clashes });
  if (problems.length > 0) {
    const shown = problems.slice(0, 8).join(" ");
    const more = problems.length > 8 ? ` (and ${problems.length - 8} more)` : "";
    throw appError("INVALID_INPUT", `This crossword can't be saved yet: ${shown}${more}`);
  }
  return { entries, layout, arranged: placed.some((entry) => entry.at !== undefined), version: crosswordVersion(entries, layout) };
}

// --- Validators -------------------------------------------------------------------------

export const staffCrosswordValidator = v.object({
  _id: v.id("crosswords"),
  courseId: v.id("courses"),
  courseTitle: v.string(),
  weekId: v.id("weeks"),
  weekTitle: v.string(),
  weekStatus: publishStatusValidator,
  title: v.string(),
  entries: v.array(crosswordEntryValidator),
  layout: crosswordLayoutValidator,
  /** The words were put in place by hand (the editor's Arrange, or an agent). */
  arranged: v.boolean(),
  status: publishStatusValidator,
  /** May change it: a course editor with the crosswords feature, in a course that isn't archived. */
  canEdit: v.boolean(),
  /** May publish, unpublish or delete it: any of the course's editors. */
  canManage: v.boolean(),
  createdVia: v.union(v.literal("web"), v.literal("mcp")),
  updatedAt: v.number(),
  /** Students who opened it and who solved it (counted up to 1000). */
  students: v.object({ started: v.number(), solved: v.number() }),
});

const studentCellValidator = v.object({ row: v.number(), col: v.number(), number: v.optional(v.number()) });
const studentWordValidator = v.object({
  id: v.string(),
  number: v.number(),
  dir: v.union(v.literal("across"), v.literal("down")),
  clue: v.string(),
  enumeration: v.string(),
  cells: v.array(v.number()),
});
const studentProgressValidator = v.object({
  letters: v.array(v.string()),
  revealed: v.array(v.number()),
  solved: v.boolean(),
});

/** The puzzle as students get it: the grid and the clues, never the answers. */
export const studentCrosswordValidator = v.object({
  _id: v.id("crosswords"),
  title: v.string(),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  week: v.object({ _id: v.id("weeks"), title: v.string() }),
  width: v.number(),
  height: v.number(),
  cells: v.array(studentCellValidator),
  words: v.array(studentWordValidator),
  /** Their saved letters, or null when they haven't started (or the puzzle changed since). */
  progress: v.union(v.null(), studentProgressValidator),
});

// --- Staff ------------------------------------------------------------------------------

/** The crossword, if the actor may change it: a course editor with the feature. Agents only touch drafts. */
async function requireCrossword(ctx: QueryCtx, actor: Actor, crosswordId: Id<"crosswords">, need: "edit" | "manage" = "edit") {
  const crossword = await ctx.db.get("crosswords", crosswordId);
  if (crossword === null) {
    throw appError("NOT_FOUND", "Crossword not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, crossword.courseId);
  if (need === "edit") requireFeature(actor, "crosswords");
  if (actor.via === "mcp" && crossword.status !== "draft") {
    throw appError(
      "CONFLICT",
      `"${crossword.title}" is published, so only the teacher can change it. Ask them to move it back to draft first.`,
    );
  }
  return { crossword, course };
}

async function studentCounts(ctx: QueryCtx, crosswordId: Id<"crosswords">, version: string) {
  const rows = await ctx.db
    .query("crosswordProgress")
    .withIndex("by_crosswordId_and_userId", (q) => q.eq("crosswordId", crosswordId))
    .take(1000);
  const current = rows.filter((row) => row.version === version);
  return { started: current.length, solved: current.filter((row) => row.solvedAt !== undefined).length };
}

export async function getCrossword(ctx: QueryCtx, actor: Actor, crosswordId: Id<"crosswords">) {
  const crossword = await ctx.db.get("crosswords", crosswordId);
  if (crossword === null) {
    throw appError("NOT_FOUND", "Crossword not found.");
  }
  const access = await courseAccess(ctx, actor, crossword.courseId);
  const week = await ctx.db.get("weeks", crossword.weekId);
  const open = access.canEdit && access.course.status !== "archived";
  return {
    _id: crossword._id,
    courseId: crossword.courseId,
    courseTitle: access.course.title,
    weekId: crossword.weekId,
    weekTitle: week?.title ?? "",
    weekStatus: week?.status ?? ("draft" as const),
    title: crossword.title,
    entries: crossword.entries,
    layout: crossword.layout,
    arranged: crossword.arranged ?? false,
    status: crossword.status,
    canEdit: open && actorHas(actor, "crosswords"),
    canManage: open,
    createdVia: crossword.createdVia,
    updatedAt: crossword.updatedAt,
    students: await studentCounts(ctx, crossword._id, crossword.version),
  };
}

/** A new draft at the end of the week. The editor starts from a few example words; agents send their own. */
export async function createCrossword(
  ctx: MutationCtx,
  actor: Actor,
  args: { weekId: Id<"weeks">; title: string; entries?: CrosswordEntryInput[] },
): Promise<Id<"crosswords">> {
  const week = await ctx.db.get("weeks", args.weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, week.courseId);
  requireFeature(actor, "crosswords");
  const existing = await crosswordsOf(ctx, args.weekId);
  if (existing.length >= MAX_CROSSWORDS_PER_WEEK) {
    throw appError("CONFLICT", `A week can have at most ${MAX_CROSSWORDS_PER_WEEK} crosswords.`);
  }
  const title = requireText(args.title, "Title", CROSSWORD_LIMITS.title);
  const built = buildCrossword(args.entries && args.entries.length > 0 ? args.entries : STARTER);
  const crosswordId = await ctx.db.insert("crosswords", {
    courseId: week.courseId,
    weekId: args.weekId,
    order: existing.length === 0 ? 1 : existing[existing.length - 1].order + 1,
    title,
    ...built,
    status: "draft",
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: Date.now(),
  });
  await logAudit(ctx, actor, {
    action: "crossword.create",
    targetTable: "crosswords",
    targetId: crosswordId,
    courseId: week.courseId,
    summary: `Drafted the crossword "${title}" (${built.entries.length} words) in "${week.title}" of "${course.title}"`,
  });
  return crosswordId;
}

/** Saves the title and/or every word at once. Changing the words of a published crossword starts students over. */
export async function saveCrossword(
  ctx: MutationCtx,
  actor: Actor,
  crosswordId: Id<"crosswords">,
  patch: { title?: string; entries?: CrosswordEntryInput[] },
): Promise<string[]> {
  const { crossword } = await requireCrossword(ctx, actor, crosswordId);
  const changes: Partial<Doc<"crosswords">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", CROSSWORD_LIMITS.title);
  if (patch.entries !== undefined) Object.assign(changes, buildCrossword(patch.entries));
  await ctx.db.patch("crosswords", crosswordId, { ...changes, updatedAt: Date.now() });
  return (changes.entries ?? crossword.entries).map((entry) => entry.id);
}

/** Up or down within its week, or to the end of another week of the same course. */
export async function moveCrossword(
  ctx: MutationCtx,
  actor: Actor,
  crosswordId: Id<"crosswords">,
  to: { direction: "up" | "down" } | { weekId: Id<"weeks"> },
) {
  const { crossword, course } = await requireCrossword(ctx, actor, crosswordId);
  if ("weekId" in to) {
    const week = await ctx.db.get("weeks", to.weekId);
    if (week === null || week.courseId !== crossword.courseId) {
      throw appError("NOT_FOUND", "Week not found in this course.");
    }
    if (week._id === crossword.weekId) return;
    const there = await crosswordsOf(ctx, week._id);
    if (there.length >= MAX_CROSSWORDS_PER_WEEK) {
      throw appError("CONFLICT", `“${week.title}” already has ${MAX_CROSSWORDS_PER_WEEK} crosswords, the most a week can hold.`);
    }
    await ctx.db.patch("crosswords", crosswordId, {
      weekId: week._id,
      order: there.length === 0 ? 1 : there[there.length - 1].order + 1,
      updatedAt: Date.now(),
    });
    await logAudit(ctx, actor, {
      action: "crossword.move",
      targetTable: "crosswords",
      targetId: crosswordId,
      courseId: crossword.courseId,
      summary: `Moved the crossword "${crossword.title}" to "${week.title}" in "${course.title}"`,
    });
    return;
  }
  const siblings = await crosswordsOf(ctx, crossword.weekId);
  const index = siblings.findIndex((c) => c._id === crosswordId);
  const other = siblings[to.direction === "up" ? index - 1 : index + 1];
  if (other === undefined) return;
  // Agents may only swap drafts; a published neighbour keeps its place for students.
  if (actor.via === "mcp" && other.status !== "draft") {
    throw appError("CONFLICT", `"${other.title}" is published, so only the teacher can move crosswords around it.`);
  }
  await ctx.db.patch("crosswords", crossword._id, { order: other.order });
  await ctx.db.patch("crosswords", other._id, { order: crossword.order });
}

export async function setCrosswordStatus(ctx: MutationCtx, actor: Actor, crosswordId: Id<"crosswords">, status: "draft" | "published") {
  if (actor.via === "mcp") {
    throw appError("FORBIDDEN", "Only the teacher can publish or unpublish a crossword, in the Kalami dashboard.");
  }
  const { crossword, course } = await requireCrossword(ctx, actor, crosswordId, "manage");
  const now = Date.now();
  await ctx.db.patch("crosswords", crosswordId, {
    status,
    publishedAt: status === "published" ? (crossword.publishedAt ?? now) : crossword.publishedAt,
    updatedAt: now,
  });
  await logAudit(ctx, actor, {
    action: status === "published" ? "crossword.publish" : "crossword.unpublish",
    targetTable: "crosswords",
    targetId: crosswordId,
    courseId: crossword.courseId,
    summary: `${status === "published" ? "Published" : "Hid"} the crossword "${crossword.title}" in "${course.title}"`,
  });
}

/** Removes the crossword and what students had filled in. */
export async function deleteCrosswordRows(ctx: MutationCtx, crosswordId: Id<"crosswords">) {
  for (;;) {
    const rows = await ctx.db
      .query("crosswordProgress")
      .withIndex("by_crosswordId_and_userId", (q) => q.eq("crosswordId", crosswordId))
      .take(500);
    for (const row of rows) await ctx.db.delete("crosswordProgress", row._id);
    if (rows.length < 500) break;
  }
  await ctx.db.delete("crosswords", crosswordId);
}

export async function deleteCrossword(ctx: MutationCtx, actor: Actor, crosswordId: Id<"crosswords">) {
  const { crossword, course } = await requireCrossword(ctx, actor, crosswordId, actor.via === "mcp" ? "edit" : "manage");
  await deleteCrosswordRows(ctx, crosswordId);
  await logAudit(ctx, actor, {
    action: "crossword.delete",
    targetTable: "crosswords",
    targetId: crosswordId,
    courseId: crossword.courseId,
    summary: `Deleted the crossword "${crossword.title}" from "${course.title}"`,
  });
}

// --- Students ---------------------------------------------------------------------------

/**
 * The crossword for a student of its course: the course visible, the student
 * enrolled, the week and the crossword published. Anything else is NOT_FOUND,
 * so drafts can't be probed.
 */
async function requireStudentCrossword(ctx: QueryCtx, student: Student, crosswordId: Id<"crosswords">) {
  const crossword = await ctx.db.get("crosswords", crosswordId);
  const course = crossword === null ? null : await ctx.db.get("courses", crossword.courseId);
  const week = crossword === null ? null : await ctx.db.get("weeks", crossword.weekId);
  const enrollment =
    course === null
      ? null
      : await ctx.db
          .query("enrollments")
          .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", course._id).eq("userId", student.user._id))
          .unique();
  if (
    crossword === null ||
    course === null ||
    week === null ||
    course.status === "draft" ||
    enrollment?.status !== "active" ||
    week.status !== "published" ||
    crossword.status !== "published"
  ) {
    throw appError("NOT_FOUND", "Crossword not found.");
  }
  return { crossword, course, week };
}

async function progressOf(ctx: QueryCtx, crosswordId: Id<"crosswords">, userId: Id<"users">) {
  return await ctx.db
    .query("crosswordProgress")
    .withIndex("by_crosswordId_and_userId", (q) => q.eq("crosswordId", crosswordId).eq("userId", userId))
    .unique();
}

export async function getStudentCrossword(ctx: QueryCtx, student: Student, crosswordId: Id<"crosswords">) {
  const { crossword, course, week } = await requireStudentCrossword(ctx, student, crosswordId);
  const { cells, words } = crosswordGrid(crossword.entries, crossword.layout);
  const progress = await progressOf(ctx, crosswordId, student.user._id);
  return {
    _id: crossword._id,
    title: crossword.title,
    course: { _id: course._id, title: course.title },
    week: { _id: week._id, title: week.title },
    width: crossword.layout.width,
    height: crossword.layout.height,
    cells,
    words,
    progress:
      progress === null || progress.version !== crossword.version
        ? null
        : { letters: progress.letters, revealed: progress.revealed, solved: progress.solvedAt !== undefined },
  };
}

export const progressResultValidator = v.object({
  /** Every cell filled with the right letter. */
  solved: v.boolean(),
  /** Every cell has a letter (right or not). */
  full: v.boolean(),
  /** With `check`: the filled cells whose letter is wrong. */
  wrong: v.optional(v.array(v.number())),
});

/**
 * Saves the student's letters (one per cell, "" for empty). `check` also
 * says which filled cells are wrong. The puzzle counts as solved the first
 * time every cell is right.
 */
export async function saveCrosswordProgress(
  ctx: MutationCtx,
  student: Student,
  crosswordId: Id<"crosswords">,
  rawLetters: string[],
  check: boolean,
) {
  await enforceLimit(ctx, "crossword", student.user._id);
  const { crossword } = await requireStudentCrossword(ctx, student, crosswordId);
  const { solution } = crosswordGrid(crossword.entries, crossword.layout);
  if (rawLetters.length !== solution.length) {
    throw appError("CONFLICT", "This crossword has changed. Reload the page to get the new one.");
  }
  const letters = rawLetters.map((raw) => (raw === "" ? "" : (normalizeLetter(raw) ?? "")));
  const full = letters.every((letter) => letter !== "");
  const correct = full && letters.every((letter, i) => letter === solution[i]);
  const existing = await progressOf(ctx, crosswordId, student.user._id);
  const current = existing !== null && existing.version === crossword.version ? existing : null;
  const now = Date.now();
  const row = {
    version: crossword.version,
    letters,
    revealed: current?.revealed ?? [],
    solvedAt: current?.solvedAt ?? (correct ? now : undefined),
    updatedAt: now,
  };
  if (existing === null) {
    await ctx.db.insert("crosswordProgress", { crosswordId, userId: student.user._id, ...row });
  } else {
    await ctx.db.replace("crosswordProgress", existing._id, { crosswordId, userId: student.user._id, ...row });
  }
  return {
    solved: correct,
    full,
    wrong: check ? letters.flatMap((letter, i) => (letter !== "" && letter !== solution[i] ? [i] : [])) : undefined,
  };
}

/**
 * Shows the right letters in these cells (a letter, a word, or the whole
 * grid). Only cells that were empty or wrong change, and only those count as
 * revealed: letters the student already got right stay theirs.
 */
export async function revealCrosswordCells(ctx: MutationCtx, student: Student, crosswordId: Id<"crosswords">, cells: number[]) {
  await enforceLimit(ctx, "crossword", student.user._id);
  const { crossword } = await requireStudentCrossword(ctx, student, crosswordId);
  const { solution } = crosswordGrid(crossword.entries, crossword.layout);
  const wanted = [...new Set(cells)].filter((i) => Number.isInteger(i) && i >= 0 && i < solution.length);
  const existing = await progressOf(ctx, crosswordId, student.user._id);
  const current = existing !== null && existing.version === crossword.version ? existing : null;
  const letters = current?.letters.length === solution.length ? [...current.letters] : solution.map(() => "");
  const changed = wanted.filter((i) => letters[i] !== solution[i]);
  for (const i of changed) letters[i] = solution[i];
  const revealed = [...new Set([...(current?.revealed ?? []), ...changed])].sort((a, b) => a - b);
  const now = Date.now();
  const correct = letters.every((letter, i) => letter === solution[i]);
  const row = {
    crosswordId,
    userId: student.user._id,
    version: crossword.version,
    letters,
    revealed,
    solvedAt: current?.solvedAt ?? (correct ? now : undefined),
    updatedAt: now,
  };
  if (existing === null) await ctx.db.insert("crosswordProgress", row);
  else await ctx.db.replace("crosswordProgress", existing._id, row);
  return changed.map((i) => ({ cell: i, letter: solution[i] }));
}
