/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { expectAppError, seed } from "./test.setup";

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

  test("removing a draft week removes its presentations", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "Gone soon" });
    await nino.mutation(api.weeks.remove, { weekId });
    await expectAppError(nino.query(api.presentations.get, { presentationId }), "NOT_FOUND");
  });
});
