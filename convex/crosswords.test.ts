/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { crosswordGrid } from "./lib/crossword";
import { expectAppError, seed, type TestBackend } from "./test.setup";

const SECRET = "test-service-secret-0123456789abcdef";
beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function credential(clerkUserId: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

const WORDS = [
  { answer: "Browser", clue: "Draws web pages" },
  { answer: "Server", clue: "Answers requests" },
  { answer: "CSS", clue: "Styles a page" },
  { answer: "Cache", clue: "Keeps copies close" },
  { answer: "Domain name", clue: "kalami.space is one" },
];

async function userId(t: TestBackend, email: string): Promise<Id<"users">> {
  return await t.run(async (ctx) => (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique())!._id);
}

/** The super admin switches crosswords on for nino. */
async function grant(s: Awaited<ReturnType<typeof seed>>, enabled = true) {
  await s.admin.mutation(api.people.setFeature, { userId: await userId(s.t, "nino@example.com"), feature: "crosswords", enabled });
}

/** The right letters for the crossword, cell by cell. */
async function solutionOf(s: Awaited<ReturnType<typeof seed>>, crosswordId: Id<"crosswords">) {
  const crossword = await s.nino.query(api.crosswords.get, { crosswordId });
  return crosswordGrid(crossword.entries, crossword.layout).solution;
}

describe("the crosswords feature", () => {
  test("is off until the super admin turns it on for a teacher, and only the super admin can", async () => {
    const s = await seed();
    const { nino, ana, admin, courseId } = s;
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    expect((await nino.query(api.weeks.outline, { courseId, now: Date.now() })).canMakeCrosswords).toBe(false);
    await expectAppError(nino.mutation(api.crosswords.create, { weekId, title: "Web words" }), "FORBIDDEN");

    const ninoId = await userId(s.t, "nino@example.com");
    await expectAppError(nino.mutation(api.people.setFeature, { userId: ninoId, feature: "crosswords", enabled: true }), "FORBIDDEN");
    await expectAppError(
      admin.mutation(api.people.setFeature, { userId: await userId(s.t, "ana@example.com"), feature: "crosswords", enabled: true }),
      "CONFLICT",
    );
    await grant(s);
    expect((await admin.query(api.people.search, { query: "nino" }))[0].features).toEqual(["crosswords"]);
    expect((await nino.query(api.weeks.outline, { courseId, now: Date.now() })).canMakeCrosswords).toBe(true);

    // The super admin has it without asking.
    expect((await admin.query(api.weeks.outline, { courseId, now: Date.now() })).canMakeCrosswords).toBe(true);
    void ana;
  });

  test("a teacher makes one: it starts from example words, saves checked words, and lists every problem", async () => {
    const s = await seed();
    const { nino, courseId } = s;
    await grant(s);
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const crosswordId = await nino.mutation(api.crosswords.create, { weekId, title: " Web words " });
    let crossword = await nino.query(api.crosswords.get, { crosswordId });
    expect(crossword).toMatchObject({ title: "Web words", status: "draft", canEdit: true, createdVia: "web", students: { started: 0, solved: 0 } });
    expect(crossword.entries.map((e) => e.answer)).toEqual(["Crossword", "Word", "Clue", "Grid"]);
    expect(crossword.layout.unplaced).toEqual([]);

    const ids = await nino.mutation(api.crosswords.save, { crosswordId, entries: [{ id: crossword.entries[0].id, ...WORDS[0] }, ...WORDS.slice(1)] });
    expect(ids[0]).toBe(crossword.entries[0].id);
    crossword = await nino.query(api.crosswords.get, { crosswordId });
    expect(crossword.entries.map((e) => e.answer)).toEqual(WORDS.map((w) => w.answer));
    expect(crossword.layout.placements).toHaveLength(WORDS.length);

    const refused = await nino
      .mutation(api.crosswords.save, { crosswordId, entries: [...WORDS, { answer: "Qqq", clue: "" }] })
      .catch((e: { data?: { message?: string } }) => e.data?.message);
    expect(refused).toContain("entries[5].clue: can't be empty.");

    const outline = await nino.query(api.weeks.outline, { courseId, now: Date.now() });
    expect(outline.weeks[0].crosswords).toEqual([expect.objectContaining({ _id: crosswordId, title: "Web words", wordCount: 5, status: "draft" })]);

    // Without the feature they can't change it any more, but can still take it down.
    await grant(s, false);
    expect((await nino.query(api.crosswords.get, { crosswordId })).canEdit).toBe(false);
    await expectAppError(nino.mutation(api.crosswords.save, { crosswordId, title: "Again" }), "FORBIDDEN");
    await nino.mutation(api.crosswords.setStatus, { crosswordId, status: "published" });
    await nino.mutation(api.crosswords.remove, { crosswordId });
    expect((await nino.query(api.weeks.outline, { courseId, now: Date.now() })).weeks[0].crosswords).toEqual([]);
  });

  test("words put in place by hand stay there; one that can't go there is refused; Lay out again resets", async () => {
    const s = await seed();
    const { nino, courseId } = s;
    await grant(s);
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const crosswordId = await nino.mutation(api.crosswords.create, { weekId, title: "Web words" });
    await nino.mutation(api.crosswords.save, { crosswordId, entries: WORDS });
    let crossword = await nino.query(api.crosswords.get, { crosswordId });
    expect(crossword.arranged).toBe(false);

    // Move CSS to stand on its own under the grid; everything else stays where it is.
    const at = new Map(crossword.layout.placements.map((p) => [p.id, { row: p.row, col: p.col, dir: p.dir }]));
    const moved = crossword.entries.map((entry) =>
      entry.answer === "CSS" ? { ...entry, at: { row: crossword.layout.height + 1, col: 0, dir: "across" as const } } : { ...entry, at: at.get(entry.id) },
    );
    await nino.mutation(api.crosswords.save, { crosswordId, entries: moved });
    crossword = await nino.query(api.crosswords.get, { crosswordId });
    expect(crossword.arranged).toBe(true);
    const css = crossword.entries.find((entry) => entry.answer === "CSS")!;
    expect(crossword.layout.placements.find((p) => p.id === css.id)).toMatchObject({ col: 0, dir: "across" });

    // On top of another word: refused, with the reason.
    const first = crossword.layout.placements.find((p) => p.id !== css.id)!;
    const refused = await nino
      .mutation(api.crosswords.save, {
        crosswordId,
        entries: crossword.entries.map((entry) => {
          const own = crossword.layout.placements.find((p) => p.id === entry.id)!;
          const spot = entry.id === css.id ? first : own;
          return { ...entry, at: { row: spot.row, col: spot.col, dir: spot.dir } };
        }),
      })
      .catch((e: { data?: { message?: string } }) => e.data?.message);
    expect(refused).toContain("can't go where it was put");

    // Without positions Kalami lays it out again.
    await nino.mutation(api.crosswords.save, { crosswordId, entries: crossword.entries });
    expect((await nino.query(api.crosswords.get, { crosswordId })).arranged).toBe(false);
  });

  test("an agent drafts one with words and clues, never publishes, and needs the feature", async () => {
    const s = await seed();
    const { nino, courseId } = s;
    const token = await credential("nino");
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    expect((await nino.query(api.mcp.whoami, { token }))?.features).toEqual([]);
    await expectAppError(
      nino.mutation(api.mcp.createCrosswordAsAgent, { token, weekId, title: "Web words", entries: WORDS }),
      "FORBIDDEN",
    );
    await grant(s);
    expect((await nino.query(api.mcp.whoami, { token }))?.features).toEqual(["crosswords"]);
    const crosswordId = await nino.mutation(api.mcp.createCrosswordAsAgent, { token, requestId: "cw-1", weekId, title: "Web words", entries: WORDS });
    expect(await nino.mutation(api.mcp.createCrosswordAsAgent, { token, requestId: "cw-1", weekId, title: "Again", entries: WORDS })).toBe(crosswordId);
    const crossword = await nino.query(api.mcp.getCrosswordAsAgent, { token, crosswordId });
    expect(crossword).toMatchObject({ createdVia: "mcp", status: "draft" });

    await nino.mutation(api.mcp.updateCrosswordAsAgent, { token, crosswordId, title: "Web basics" });
    await nino.mutation(api.crosswords.setStatus, { crosswordId, status: "published" });
    await expectAppError(nino.mutation(api.mcp.updateCrosswordAsAgent, { token, crosswordId, title: "Changed" }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.deleteCrosswordAsAgent, { token, crosswordId }), "CONFLICT");
  });
});

describe("students and crosswords", () => {
  async function published(s: Awaited<ReturnType<typeof seed>>) {
    await grant(s);
    const weekId = await s.nino.mutation(api.weeks.create, { courseId: s.courseId });
    const crosswordId = await s.nino.mutation(api.crosswords.create, { weekId, title: "Web words" });
    await s.nino.mutation(api.crosswords.save, { crosswordId, entries: WORDS });
    return { weekId, crosswordId };
  }

  test("see it once its week is published, and get the grid and clues but never the answers", async () => {
    const s = await seed();
    const { ana, maka, nino } = s;
    const { weekId, crosswordId } = await published(s);
    await expectAppError(ana.query(api.crosswords.read, { crosswordId }), "NOT_FOUND");
    await nino.mutation(api.weeks.publish, { weekId });
    const puzzle = await ana.query(api.crosswords.read, { crosswordId });
    expect(puzzle).toMatchObject({ title: "Web words", progress: null });
    expect(puzzle.words).toHaveLength(WORDS.length);
    expect(puzzle.words.find((w) => w.clue === "kalami.space is one")?.enumeration).toBe("(6, 4)");
    const text = JSON.stringify(puzzle).toLowerCase();
    for (const word of ["browser", "server", "cache", "domainname"]) expect(text).not.toContain(word);
    expect((await ana.query(api.learn.course, { courseId: s.courseId })).weeks[0].crosswords).toEqual([
      { _id: crosswordId, title: "Web words", wordCount: 5 },
    ]);
    await expectAppError(maka.query(api.crosswords.read, { crosswordId }), "NOT_FOUND");
  });

  test("save letters, check them, reveal a word, and solve it; the teacher sees the counts", async () => {
    const s = await seed();
    const { ana, nino } = s;
    const { weekId, crosswordId } = await published(s);
    await nino.mutation(api.weeks.publish, { weekId });
    const solution = await solutionOf(s, crosswordId);
    const puzzle = await ana.query(api.crosswords.read, { crosswordId });

    // Two letters in, one of them wrong (and typed in capitals).
    const letters = solution.map(() => "");
    letters[0] = solution[0].toUpperCase();
    letters[1] = solution[1] === "x" ? "y" : "x";
    expect(await ana.mutation(api.crosswords.saveProgress, { crosswordId, letters, check: true })).toEqual({ solved: false, full: false, wrong: [1] });
    expect((await ana.query(api.crosswords.read, { crosswordId })).progress).toEqual({
      letters: [solution[0], letters[1], ...letters.slice(2)],
      revealed: [],
      solved: false,
    });

    // Reveal the first word: only its empty or wrong squares change, and only those count as revealed.
    const first = puzzle.words[0];
    const before = (await ana.query(api.crosswords.read, { crosswordId })).progress!.letters;
    const changing = first.cells.filter((i) => before[i] !== solution[i]);
    const shown = await ana.mutation(api.crosswords.reveal, { crosswordId, cells: first.cells });
    expect(shown).toEqual(changing.map((cell) => ({ cell, letter: solution[cell] })));

    // Everything right: solved, and it stays solved.
    expect(await ana.mutation(api.crosswords.saveProgress, { crosswordId, letters: solution })).toEqual({ solved: true, full: true });
    const done = (await ana.query(api.crosswords.read, { crosswordId })).progress;
    expect(done?.solved).toBe(true);
    expect(done?.revealed).toEqual([...changing].sort((a, b) => a - b));
    expect((await nino.query(api.crosswords.get, { crosswordId })).students).toEqual({ started: 1, solved: 1 });

    // A wrong number of letters means the page is out of date.
    await expectAppError(ana.mutation(api.crosswords.saveProgress, { crosswordId, letters: ["a"] }), "CONFLICT");
  });

  test("changing the words starts students over; deleting the course removes it all", async () => {
    const s = await seed();
    const { t, ana, nino, courseId } = s;
    const { weekId, crosswordId } = await published(s);
    await nino.mutation(api.weeks.publish, { weekId });
    await ana.mutation(api.crosswords.saveProgress, { crosswordId, letters: await solutionOf(s, crosswordId) });

    // A new clue keeps progress; a new word doesn't.
    const entries = (await nino.query(api.crosswords.get, { crosswordId })).entries;
    await nino.mutation(api.crosswords.save, { crosswordId, entries: entries.map((e, i) => (i === 0 ? { ...e, clue: "Shows pages" } : e)) });
    expect((await ana.query(api.crosswords.read, { crosswordId })).progress?.solved).toBe(true);
    await nino.mutation(api.crosswords.save, { crosswordId, entries: [...entries, { answer: "Network", clue: "Computers talking" }] });
    expect((await ana.query(api.crosswords.read, { crosswordId })).progress).toBeNull();
    expect((await nino.query(api.crosswords.get, { crosswordId })).students).toEqual({ started: 0, solved: 0 });

    await nino.mutation(api.courses.remove, { courseId });
    await t.mutation(internal.courses.purge, { courseId });
    expect(await t.run(async (ctx) => [(await ctx.db.query("crosswords").take(10)).length, (await ctx.db.query("crosswordProgress").take(10)).length])).toEqual([0, 0]);
  });
});
