import type { AuthInfo, CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  arrangeCrossword,
  CROSSWORD_LIMITS,
  crosswordGrid,
  crosswordProblems,
  displayLetter,
  type CrosswordEntry,
  type CrosswordLayout,
} from "@/convex/lib/crossword";

/**
 * The crossword tools of the staff connector. They are only offered to
 * people the super admin gave the "crosswords" feature (server.ts picks the
 * handler by the person's features; Convex checks again on every call).
 * Agents write words and clues; Kalami lays out the grid.
 */

export const CROSSWORD_INSTRUCTIONS = `

Crosswords (switched on for this teacher):
- A crossword is its own item in a week, next to lessons and presentations: a practice puzzle students fill in on Kalami (checked, not graded). Use it when the teacher asks for a crossword, or to revise a week's vocabulary.
- You write the words and clues; Kalami lays out the grid and numbers it. Never draw a grid yourself.
- Write 8 to 15 words in the course's language (4 to 30 allowed), 3 to 12 letters each works best. Answers are single words or short phrases (spaces and hyphens are fine; only letters go in the grid). Words must share letters with each other to cross; a word that shares no letters can't be placed.
- Clues: one short line each, in the course's language, never containing the answer or an obvious form of it. Facts must be right.
- Call check_crossword first to see the grid and any problems, fix them, then create_crossword (a draft). Give the teacher the reviewUrl: they review it and publish it with the week.
- update_crossword replaces every word at once (keep the ids from get_crossword). Changing the words of a published crossword starts students over, so only the teacher does that.
- Placing words yourself (only when the teacher asks, e.g. "put HTML along the top"): give a word row, col and dir (row 0 is the top, col 0 the left; dir across or down; its first letter goes there). Words keep those places as long as their letters agree where they cross and they don't sit right beside another word; words without a place are fitted around them. get_crossword gives every word's row, col and dir: to move one word, send all words back with their places and change that one. Leave places out entirely to let Kalami lay out the grid again.`;

type ToolContext = { http?: { authInfo?: AuthInfo } };

/** What server.ts shares with these tools. */
export type CrosswordToolHelpers = {
  convex: ConvexHttpClient;
  auth: (ctx: ToolContext) => { token: string; client?: string };
  run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
  dashboardUrl: (ctx: ToolContext, path: string) => string;
  requestId: z.ZodOptional<z.ZodString>;
};

const entriesSchema = z
  .array(
    z.object({
      id: z.string().max(40).optional().describe("Keep the id from get_crossword when updating; leave out for new words"),
      answer: z.string().min(1).max(CROSSWORD_LIMITS.answer).describe(`The word or short phrase (${CROSSWORD_LIMITS.lettersMin} to ${CROSSWORD_LIMITS.letters} letters)`),
      clue: z.string().min(1).max(CROSSWORD_LIMITS.clue).describe("One short line that leads to the answer without containing it"),
      row: z.number().int().min(-50).max(50).optional().describe("Only to place the word yourself: the row of its first letter (0 is the top). Give row, col and dir together"),
      col: z.number().int().min(-50).max(50).optional().describe("Only to place the word yourself: the column of its first letter (0 is the left)"),
      dir: z.enum(["across", "down"]).optional().describe("Only to place the word yourself: across (left to right) or down"),
    }),
  )
  .min(CROSSWORD_LIMITS.entriesMin)
  .max(CROSSWORD_LIMITS.entries)
  .refine((entries) => entries.every((e) => (e.row === undefined) === (e.col === undefined) && (e.col === undefined) === (e.dir === undefined)), {
    message: "Give row, col and dir together, or none of them, for each word.",
  });

type EntriesInput = z.infer<typeof entriesSchema>;

/** What Convex takes: a word's place, if the agent gave one, as `at`. */
function toInputs(input: EntriesInput) {
  return input.map(({ id, answer, clue, row, col, dir }) => ({
    id,
    answer,
    clue,
    at: row !== undefined && col !== undefined && dir !== undefined ? { row, col, dir } : undefined,
  }));
}

/** Every word with its place in the grid and its number: what an agent needs to move one. */
function wordsWithPlaces(entries: CrosswordEntry[], layout: CrosswordLayout) {
  const placed = new Map(layout.placements.map((p) => [p.id, p]));
  return entries.map((entry) => {
    const p = placed.get(entry.id);
    return p ? { ...entry, row: p.row, col: p.col, dir: p.dir, number: p.number } : { ...entry, notInGrid: true };
  });
}

/** The grid as text, one row per line ("." is a black square), so an agent can see what students get. */
export function gridPreview(entries: CrosswordEntry[], layout: CrosswordLayout): string {
  const { cells, solution } = crosswordGrid(entries, layout);
  const rows = Array.from({ length: layout.height }, () => Array.from({ length: layout.width }, () => "."));
  cells.forEach((cell, i) => {
    rows[cell.row][cell.col] = displayLetter(solution[i]);
  });
  return rows.map((row) => row.join(" ")).join("\n");
}

/** Lays the words out the way Kalami will, with the problems that would stop a save. */
function checked(input: EntriesInput) {
  const entries = toInputs(input).map((entry, i) => ({ ...entry, id: entry.id ?? `new${i}` }));
  const layout = arrangeCrossword(entries);
  return { entries, layout, problems: crosswordProblems(entries, layout) };
}

function clueList(entries: CrosswordEntry[], layout: CrosswordLayout) {
  const { words } = crosswordGrid(entries, layout);
  return words.map((word) => `${word.number} ${word.dir}: ${word.clue} ${word.enumeration}`);
}

export function registerCrosswordTools(server: McpServer, h: CrosswordToolHelpers) {
  const convex = h.convex;
  const weekId = z.string().describe("Week id from create_week or get_course_outline");
  const crosswordId = z.string().describe("A crossword id, from create_crossword or get_course_outline");

  server.registerTool(
    "check_crossword",
    {
      title: "Check crossword",
      description:
        "Lays out words and clues the way Kalami will, without saving anything: the grid as text (\".\" is a black square), the numbered clues, every word's row, col and dir, and every problem that would stop a save (such as a word that can't cross the others, or a word placed where it doesn't fit). Use it before create_crossword or update_crossword.",
      inputSchema: z.object({ entries: entriesSchema }),
    },
    async (args) =>
      h.run(async () => {
        const { entries, layout, problems } = checked(args.entries);
        return {
          ok: problems.length === 0,
          problems,
          size: `${layout.width} × ${layout.height}`,
          grid: gridPreview(entries, layout),
          clues: clueList(entries, layout),
          words: wordsWithPlaces(entries, layout),
        };
      }),
  );

  server.registerTool(
    "create_crossword",
    {
      title: "Create crossword",
      description:
        "Creates a draft crossword at the end of a week from words and clues; Kalami lays out and numbers the grid (or keeps the places you gave). Returns its id, the grid as text, every word's place and a reviewUrl. The teacher reviews and publishes it.",
      inputSchema: z.object({
        requestId: h.requestId,
        weekId,
        title: z.string().min(1).max(CROSSWORD_LIMITS.title).describe("The crossword's name in the course outline"),
        entries: entriesSchema,
      }),
    },
    async (args, ctx) =>
      h.run(async () => {
        const { problems } = checked(args.entries);
        if (problems.length > 0) throw new Error(`The crossword can't be saved yet: ${problems.join(" ")}`);
        const id = await convex.mutation(api.mcp.createCrosswordAsAgent, {
          ...h.auth(ctx),
          requestId: args.requestId,
          weekId: args.weekId as Id<"weeks">,
          title: args.title,
          entries: toInputs(args.entries),
        });
        const crossword = await convex.query(api.mcp.getCrosswordAsAgent, {
          ...h.auth(ctx),
          crosswordId: id,
        });
        return {
          crosswordId: id,
          status: "draft",
          grid: gridPreview(crossword.entries, crossword.layout),
          words: wordsWithPlaces(crossword.entries, crossword.layout),
          reviewUrl: h.dashboardUrl(ctx, `/courses/${crossword.courseId}/crosswords/${id}`),
        };
      }),
  );

  server.registerTool(
    "get_crossword",
    {
      title: "Get crossword",
      description:
        "A crossword with its words (ids, answers, clues, and each word's row, col, dir and number in the grid), the grid as text, whether the words were placed by hand, its week and status, and how many students started and solved it.",
      inputSchema: z.object({ crosswordId }),
    },
    async (args, ctx) =>
      h.run(async () => {
        const crossword = await convex.query(api.mcp.getCrosswordAsAgent, { ...h.auth(ctx), crosswordId: args.crosswordId as Id<"crosswords"> });
        const { layout, canEdit, canManage, entries, ...rest } = crossword;
        void canEdit;
        void canManage;
        return { ...rest, words: wordsWithPlaces(entries, layout), grid: gridPreview(entries, layout), clues: clueList(entries, layout) };
      }),
  );

  server.registerTool(
    "update_crossword",
    {
      title: "Update crossword",
      description:
        "Changes a draft crossword: its title and/or its words. entries replaces every word at once: keep a word's id from get_crossword to keep it; give row, col and dir to place words yourself, or leave them out to let Kalami lay out the grid; leave entries out to change only the title. Returns the grid as text and every word's place.",
      inputSchema: z.object({
        crosswordId,
        title: z.string().min(1).max(CROSSWORD_LIMITS.title).optional(),
        entries: entriesSchema.optional(),
      }),
    },
    async (args, ctx) =>
      h.run(async () => {
        if (args.entries) {
          const { problems } = checked(args.entries);
          if (problems.length > 0) throw new Error(`The crossword can't be saved yet: ${problems.join(" ")}`);
        }
        const id = args.crosswordId as Id<"crosswords">;
        await convex.mutation(api.mcp.updateCrosswordAsAgent, {
          ...h.auth(ctx),
          crosswordId: id,
          title: args.title,
          entries: args.entries ? toInputs(args.entries) : undefined,
        });
        const crossword = await convex.query(api.mcp.getCrosswordAsAgent, {
          ...h.auth(ctx),
          crosswordId: id,
        });
        return { grid: gridPreview(crossword.entries, crossword.layout), words: wordsWithPlaces(crossword.entries, crossword.layout) };
      }),
  );

  server.registerTool(
    "move_crossword",
    {
      title: "Move crossword",
      description:
        "Moves a draft crossword up or down within its week, or to the end of another week of the same course (weekId). Published crosswords, and drafts next to them, are the teacher's to move.",
      inputSchema: z.object({
        crosswordId,
        weekId: weekId.optional().describe("Move it to the end of this week"),
        direction: z.enum(["up", "down"]).optional(),
      }),
    },
    async (args, ctx) =>
      h.run(async () => {
        await convex.mutation(api.mcp.moveCrosswordAsAgent, {
          ...h.auth(ctx),
          crosswordId: args.crosswordId as Id<"crosswords">,
          weekId: args.weekId as Id<"weeks"> | undefined,
          direction: args.direction,
        });
        return { moved: true };
      }),
  );

  server.registerTool(
    "delete_crossword",
    {
      title: "Delete crossword",
      description: "Deletes a draft crossword. Published crosswords can only be deleted by the teacher.",
      inputSchema: z.object({ crosswordId }),
    },
    async (args, ctx) =>
      h.run(async () => {
        await convex.mutation(api.mcp.deleteCrosswordAsAgent, { ...h.auth(ctx), crosswordId: args.crosswordId as Id<"crosswords"> });
        return { deleted: true };
      }),
  );
}
