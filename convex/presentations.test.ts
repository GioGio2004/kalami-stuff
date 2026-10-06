/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { expectAppError, person, seed } from "./test.setup";

const SECRET = "test-service-secret-0123456789abcdef";
beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The signed credential the staff app's MCP route hands Convex for a lecturer (see studio.test.ts). */
async function credential(clerkUserId: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

describe("presentations", () => {
  test("a new presentation starts as one title slide; the editor saves the theme and every slide, checked", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "  How the web works " });
    let deck = await nino.query(api.presentations.get, { presentationId });
    expect(deck).toMatchObject({ title: "How the web works", theme: "ink", status: "draft", createdVia: "web" });
    expect(deck.slides).toEqual([{ id: expect.any(String), type: "title", title: "How the web works" }]);

    // Every problem is reported at once, with where it is.
    await expectAppError(
      nino.mutation(api.presentations.save, {
        presentationId,
        slides: [
          { type: "points", points: ["only one"] },
          { type: "image", url: "http://example.com/a.png", alt: "" },
        ],
      }),
      "INVALID_INPUT",
    );
    const error = await nino
      .mutation(api.presentations.save, { presentationId, slides: [{ type: "diagram", layout: "cycle", nodes: [{ label: "A" }] }] })
      .catch((e: Error) => e.message);
    expect(String(error)).toContain("slides[0].nodes: 3 to 8 nodes for a cycle.");

    // Text is tidied; ids the editor sends back are kept, new slides get one.
    const first = deck.slides[0].id;
    const ids = await nino.mutation(api.presentations.save, {
      presentationId,
      theme: "aurora",
      slides: [
        { id: first, type: "title", title: " How the **web** works ", subtitle: "  " },
        { type: "points", points: [" A client ", "", "A server"], build: true, notes: "Pause here." },
      ],
    });
    expect(ids[0]).toBe(first);
    expect(ids[1]).toMatch(/^[0-9a-f]{12}$/);
    deck = await nino.query(api.presentations.get, { presentationId });
    expect(deck.theme).toBe("aurora");
    expect(deck.slides).toEqual([
      { id: first, type: "title", title: "How the **web** works" },
      { id: ids[1], type: "points", points: ["A client", "A server"], build: true, notes: "Pause here." },
    ]);
    await expectAppError(nino.mutation(api.presentations.save, { presentationId, slides: [] }), "INVALID_INPUT");
  });

  test("students see a presentation once it and its week are published, and only in their courses", async () => {
    const { nino, ana, maka, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "DNS", theme: "chalk" });
    await expectAppError(ana.query(api.presentations.read, { presentationId }), "NOT_FOUND");
    // Publishing the week publishes its draft presentations along with it.
    await nino.mutation(api.weeks.publish, { weekId });
    const deck = await ana.query(api.presentations.read, { presentationId });
    expect(deck).toMatchObject({ title: "DNS", theme: "chalk", course: { _id: courseId }, week: { _id: weekId } });
    expect(deck.slides).toHaveLength(1);
    const course = await ana.query(api.learn.course, { courseId });
    expect(course.weeks[0].presentations).toEqual([{ _id: presentationId, title: "DNS", theme: "chalk", slideCount: 1 }]);
    // A student of another course, or none, can't find it.
    await expectAppError(maka.query(api.presentations.read, { presentationId }), "NOT_FOUND");
    // Back to draft: gone again.
    await nino.mutation(api.presentations.setStatus, { presentationId, status: "draft" });
    await expectAppError(ana.query(api.presentations.read, { presentationId }), "NOT_FOUND");
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].presentations).toEqual([]);
  });

  test("an agent drafts a deck, can't publish it, and can't touch it once it's published", async () => {
    const { nino, courseId } = await seed();
    const token = await credential("nino");
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const slides = [
      { type: "title" as const, title: "How the **web** works", kicker: "Week 1" },
      {
        type: "diagram" as const,
        layout: "flow" as const,
        build: true,
        nodes: [{ label: "Browser" }, { label: "Server", edge: "GET /" }],
      },
      { type: "closing" as const, title: "Thanks", next: "Next week: HTML" },
    ];
    const presentationId = await nino.mutation(api.mcp.createPresentationAsAgent, {
      token,
      requestId: "deck-1",
      weekId,
      title: "How the web works",
      theme: "paper",
      slides,
    });
    // A retried call with the same request id returns the same presentation.
    expect(
      await nino.mutation(api.mcp.createPresentationAsAgent, { token, requestId: "deck-1", weekId, title: "Again", slides }),
    ).toBe(presentationId);
    const outline = await nino.query(api.mcp.getCourseOutline, { token, courseId });
    expect(outline.weeks[0].presentations).toEqual([
      expect.objectContaining({ _id: presentationId, theme: "paper", slideCount: 3, createdVia: "mcp", status: "draft" }),
    ]);
    const deck = await nino.query(api.mcp.getPresentationAsAgent, { token, presentationId });
    // The agent rewrites its draft: keeps two slides by id, drops one, changes the theme.
    const kept = await nino.mutation(api.mcp.updatePresentationAsAgent, {
      token,
      presentationId,
      theme: "ember",
      slides: [deck.slides[0], deck.slides[2]],
    });
    expect(kept).toEqual([deck.slides[0].id, deck.slides[2].id]);

    // Publishing stays with the lecturer; after it, the agent can't edit or delete.
    await expectAppError(
      nino.mutation(api.mcp.createPresentationAsAgent, { token, weekId, title: "Empty", slides: [] }),
      "INVALID_INPUT",
    );
    await nino.mutation(api.presentations.setStatus, { presentationId, status: "published" });
    await expectAppError(nino.mutation(api.mcp.updatePresentationAsAgent, { token, presentationId, title: "Renamed" }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.deletePresentationAsAgent, { token, presentationId }), "CONFLICT");
    // A draft one it may delete.
    const draft = await nino.mutation(api.mcp.createPresentationAsAgent, { token, weekId, title: "Scratch", slides });
    await nino.mutation(api.mcp.deletePresentationAsAgent, { token, presentationId: draft });
    await expectAppError(nino.query(api.presentations.get, { presentationId: draft }), "NOT_FOUND");
  });

  test("presentations move up and down, to another week of the course, and agents reorder drafts around published ones", async () => {
    const { nino, courseId } = await seed();
    const token = await credential("nino");
    const w1 = await nino.mutation(api.weeks.create, { courseId });
    const w2 = await nino.mutation(api.weeks.create, { courseId });
    const a = await nino.mutation(api.presentations.create, { weekId: w1, title: "A" });
    const b = await nino.mutation(api.presentations.create, { weekId: w1, title: "B" });
    const c = await nino.mutation(api.presentations.create, { weekId: w1, title: "C" });
    const titles = async (weekId: typeof w1) =>
      (await nino.query(api.weeks.outline, { courseId, now: Date.now() })).weeks
        .find((week) => week._id === weekId)!
        .presentations.map((deck) => deck.title);

    await nino.mutation(api.presentations.move, { presentationId: c, direction: "up" });
    expect(await titles(w1)).toEqual(["A", "C", "B"]);
    // Off the end: nothing happens.
    await nino.mutation(api.presentations.move, { presentationId: a, direction: "up" });
    expect(await titles(w1)).toEqual(["A", "C", "B"]);

    // Into another week: it goes to the end there.
    await nino.mutation(api.presentations.create, { weekId: w2, title: "D" });
    await nino.mutation(api.presentations.move, { presentationId: a, weekId: w2 });
    expect(await titles(w1)).toEqual(["C", "B"]);
    expect(await titles(w2)).toEqual(["D", "A"]);
    const deck = await nino.query(api.presentations.get, { presentationId: a });
    expect(deck.weekId).toBe(w2);

    // Never into another course's week.
    const other = await nino.mutation(api.courses.create, { title: "Other course" });
    const elsewhere = await nino.mutation(api.weeks.create, { courseId: other });
    await expectAppError(nino.mutation(api.presentations.move, { presentationId: b, weekId: elsewhere }), "NOT_FOUND");

    // Agents: drafts move freely, published presentations keep their order for students.
    await nino.mutation(api.presentations.setStatus, { presentationId: b, status: "published" });
    await nino.mutation(api.mcp.reorderPresentationsAsAgent, { token, weekId: w1, presentationIds: [b, c] });
    expect(await titles(w1)).toEqual(["B", "C"]);
    const e = await nino.mutation(api.presentations.create, { weekId: w1, title: "E" });
    await nino.mutation(api.presentations.setStatus, { presentationId: e, status: "published" });
    await expectAppError(
      nino.mutation(api.mcp.reorderPresentationsAsAgent, { token, weekId: w1, presentationIds: [e, b, c] }),
      "CONFLICT",
    );
    await expectAppError(
      nino.mutation(api.mcp.reorderPresentationsAsAgent, { token, weekId: w1, presentationIds: [b, c] }),
      "INVALID_INPUT",
    );
    // A published presentation is the lecturer's to move; so is a draft's published neighbour.
    await expectAppError(nino.mutation(api.mcp.movePresentationAsAgent, { token, presentationId: b, weekId: w2 }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.movePresentationAsAgent, { token, presentationId: c, direction: "up" }), "CONFLICT");
    await nino.mutation(api.mcp.movePresentationAsAgent, { token, presentationId: c, weekId: w2 });
    expect(await titles(w2)).toEqual(["D", "A", "C"]);
    await expectAppError(nino.mutation(api.mcp.movePresentationAsAgent, { token, presentationId: c }), "INVALID_INPUT");
  });

  test("removing a draft week removes its presentations", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "Gone soon" });
    await nino.mutation(api.weeks.remove, { weekId });
    await expectAppError(nino.query(api.presentations.get, { presentationId }), "NOT_FOUND");
  });
});

describe("presentation share links", () => {
  test("a shared link plays the deck for anyone, without notes unless the lecturer adds them, until it's replaced or stopped", async () => {
    const { t, nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "DNS", theme: "aurora" });
    const deck = await nino.query(api.presentations.get, { presentationId });
    await nino.mutation(api.presentations.save, {
      presentationId,
      slides: [deck.slides[0], { type: "statement", text: "Names become numbers", notes: "Ask who has a phone book." }],
    });
    expect(deck).toMatchObject({ share: null, canShare: true });

    // A draft in a draft week can be shared: the lecturer decides.
    const token = await nino.mutation(api.presentations.share, { presentationId, notes: false });
    expect(token).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect((await nino.query(api.presentations.get, { presentationId })).share).toEqual({
      token,
      notes: false,
      by: "nino",
      at: expect.any(Number),
    });
    // Nobody signs in to watch: the deck and who shared it, nothing about the course, no notes.
    const watched = await t.query(api.presentations.shared, { token });
    expect(watched).toEqual({
      title: "DNS",
      theme: "aurora",
      slides: [deck.slides[0], { id: expect.any(String), type: "statement", text: "Names become numbers" }],
      notes: false,
      sharedBy: "nino",
    });
    const outline = await nino.query(api.weeks.outline, { courseId, now: Date.now() });
    expect(outline.weeks[0].presentations[0].shared).toBe(true);

    // Speaker notes on: same link, now with notes.
    expect(await nino.mutation(api.presentations.share, { presentationId, notes: true })).toBe(token);
    expect((await t.query(api.presentations.shared, { token }))?.slides[1].notes).toBe("Ask who has a phone book.");

    // A new link: the old one is dead at once.
    const renewed = await nino.mutation(api.presentations.share, { presentationId, notes: true, newLink: true });
    expect(renewed).not.toBe(token);
    expect(await t.query(api.presentations.shared, { token })).toBeNull();
    expect((await t.query(api.presentations.shared, { token: ` ${renewed} ` }))?.title).toBe("DNS");

    // Stopped: dead, and sharing again makes yet another link.
    await nino.mutation(api.presentations.stopSharing, { presentationId });
    expect(await t.query(api.presentations.shared, { token: renewed })).toBeNull();
    expect((await nino.query(api.presentations.get, { presentationId })).share).toBeNull();
    const again = await nino.mutation(api.presentations.share, { presentationId, notes: false });
    expect([token, renewed]).not.toContain(again);

    // Garbage never reaches the index.
    expect(await t.query(api.presentations.shared, { token: "" })).toBeNull();
    expect(await t.query(api.presentations.shared, { token: "short" })).toBeNull();
    expect(await t.query(api.presentations.shared, { token: "x".repeat(500) })).toBeNull();

    // Deleting the presentation kills its link.
    await nino.mutation(api.presentations.remove, { presentationId });
    expect(await t.query(api.presentations.shared, { token: again })).toBeNull();
  });

  test("only the course's editors share, archived courses too; assistants, students and agents can't", async () => {
    const { t, nino, ana, courseId, universityId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "Old but good" });

    const luka = t.withIdentity(person("luka"));
    const lukaId = await luka.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: lukaId, role: "lecturer", universityId });
      await ctx.db.insert("courseStaff", { courseId, userId: lukaId, role: "assistant" });
    });
    await expectAppError(luka.mutation(api.presentations.share, { presentationId, notes: false }), "FORBIDDEN");
    await expectAppError(ana.mutation(api.presentations.share, { presentationId, notes: false }), "FORBIDDEN");

    // Archived courses are read-only, but their decks can still be passed around (and taken back).
    await nino.mutation(api.courses.update, { courseId, status: "archived" });
    const token = await nino.mutation(api.presentations.share, { presentationId, notes: false });
    // The assistant sees the link to copy it, and can't change it.
    expect(await luka.query(api.presentations.get, { presentationId })).toMatchObject({
      canShare: false,
      share: { token, notes: false },
    });
    await expectAppError(luka.mutation(api.presentations.stopSharing, { presentationId }), "FORBIDDEN");

    // An agent reads the link and never turns it on or off (there's no tool for it, and the model refuses).
    const agent = await nino.query(api.mcp.getPresentationAsAgent, { token: await credential("nino"), presentationId });
    expect(agent).toMatchObject({ canShare: false, share: { token } });

    await nino.mutation(api.presentations.stopSharing, { presentationId });
    expect(await t.query(api.presentations.shared, { token })).toBeNull();
  });
});
