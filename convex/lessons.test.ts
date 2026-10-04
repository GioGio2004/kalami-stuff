/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { videoEmbedUrl } from "./model/lessons";
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

describe("lesson blocks", () => {
  test("every block type is checked and gets an id", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const lessonId = await nino.mutation(api.lessons.create, {
      weekId,
      title: "Links and images",
      blocks: [
        { type: "text", md: "An **anchor** makes a link." },
        { type: "callout", tone: "definition", title: "Anchor", md: "The `<a>` element." },
        { type: "code", language: "HTML", code: '<a href="https://kalami.space">Kalami</a>', preview: true },
        { type: "code", language: "python", code: "print('hi')", preview: true },
        { type: "image", url: "https://ik.imagekit.io/kalami/cat.jpg", alt: "A cat" },
        { type: "video", url: "https://youtu.be/dQw4w9WgXcQ" },
        { type: "steps", title: "Make a link", steps: [{ md: "Type `<a>`." }, { title: "Then", md: "Add `href`." }] },
        {
          type: "check",
          check: { kind: "single", prompt: "Which tag makes a link?", options: [{ text: "<a>", correct: true }, { text: "<p>", correct: false }] },
        },
      ],
    });
    const lesson = await nino.query(api.lessons.get, { lessonId });
    expect(lesson.blocks.map((b) => b.type)).toEqual(["text", "callout", "code", "code", "image", "video", "steps", "check"]);
    expect(new Set(lesson.blocks.map((b) => b.id)).size).toBe(8);
    const [html, python] = lesson.blocks.filter((b) => b.type === "code");
    expect(html).toMatchObject({ language: "html", preview: true });
    // Only HTML and CSS can run in the preview.
    expect(python.type === "code" && python.preview).toBeFalsy();

    const bad = [
      { type: "image" as const, url: "https://x.example.com/a.png", alt: " " },
      { type: "image" as const, url: "http://x.example.com/a.png", alt: "A" },
      { type: "code" as const, language: "cobol", code: "x" },
      { type: "text" as const, md: "   " },
      { type: "steps" as const, steps: [] },
      {
        type: "check" as const,
        check: { kind: "single" as const, prompt: "Q", options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
      },
      { type: "check" as const, check: { kind: "short" as const, prompt: "Q", accepted: [] } },
    ];
    for (const block of bad) {
      await expectAppError(nino.mutation(api.lessons.addBlocksTo, { lessonId, blocks: [block] }), "INVALID_INPUT");
    }
  });

  test("blocks can be added at a position, edited, deleted, and the whole list saved", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const lessonId = await nino.mutation(api.lessons.create, { weekId, title: "L", blocks: [{ type: "text", md: "one" }, { type: "text", md: "three" }] });
    const [two] = await nino.mutation(api.lessons.addBlocksTo, { lessonId, blocks: [{ type: "text", md: "two" }], position: 1 });
    let lesson = await nino.query(api.lessons.get, { lessonId });
    expect(lesson.blocks.map((b) => (b.type === "text" ? b.md : ""))).toEqual(["one", "two", "three"]);
    await nino.mutation(api.lessons.updateBlockIn, { lessonId, blockId: two, block: { type: "callout", tone: "tip", md: "2!" } });
    await nino.mutation(api.lessons.deleteBlockFrom, { lessonId, blockId: lesson.blocks[0].id });
    lesson = await nino.query(api.lessons.get, { lessonId });
    expect(lesson.blocks.map((b) => b.type)).toEqual(["callout", "text"]);
    expect(lesson.blocks[0].id).toBe(two);
    // The editor saves everything at once and keeps ids it sends back.
    const ids = await nino.mutation(api.lessons.saveBlocks, { lessonId, blocks: [...lesson.blocks].reverse() });
    expect(ids).toEqual([lesson.blocks[1].id, lesson.blocks[0].id]);
  });

  test("students get previous/next across weeks, and only see published lessons", async () => {
    const { nino, ana, courseId } = await seed();
    const w1 = await nino.mutation(api.weeks.create, { courseId });
    const w2 = await nino.mutation(api.weeks.create, { courseId });
    const a = await nino.mutation(api.lessons.create, { weekId: w1, title: "A", blocks: [{ type: "text", md: "a" }] });
    const b = await nino.mutation(api.lessons.create, { weekId: w2, title: "B", blocks: [{ type: "text", md: "b" }] });
    await nino.mutation(api.weeks.publish, { weekId: w1 });
    await nino.mutation(api.weeks.publish, { weekId: w2 });
    expect(await ana.query(api.lessons.read, { lessonId: a })).toMatchObject({ previous: null, next: { _id: b } });
    expect(await ana.query(api.lessons.read, { lessonId: b })).toMatchObject({ previous: { _id: a }, next: null });
    // A new lesson in a published week starts as a draft and stays hidden.
    const c = await nino.mutation(api.lessons.create, { weekId: w2, title: "C", blocks: [{ type: "text", md: "c" }] });
    await expectAppError(ana.query(api.lessons.read, { lessonId: c }), "NOT_FOUND");
    await expectAppError(nino.mutation(api.lessons.setStatus, { lessonId: await nino.mutation(api.lessons.create, { weekId: w2, title: "Empty" }), status: "published" }), "CONFLICT");
    await nino.mutation(api.lessons.setStatus, { lessonId: c, status: "published" });
    expect(await ana.query(api.lessons.read, { lessonId: b })).toMatchObject({ next: { _id: c } });
  });

  test("video links become embeds only for YouTube and Vimeo", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(videoEmbedUrl("https://example.com/video.mp4")).toBeNull();
  });
});

describe("agents and the outline", () => {
  test("an agent drafts a week with a lesson and a quiz in it, but can't publish or touch published work", async () => {
    const { nino, ana, courseId } = await seed();
    const token = await credential("nino");
    const weekId = await nino.mutation(api.mcp.createWeekAsAgent, {
      token,
      requestId: "week-1",
      courseId,
      title: "Week 1 · HTML",
      links: [{ title: "MDN", url: "https://developer.mozilla.org" }],
    });
    // A retried call with the same request id returns the same week.
    expect(await nino.mutation(api.mcp.createWeekAsAgent, { token, requestId: "week-1", courseId, title: "Week 1 · HTML" })).toBe(weekId);
    const lessonId = await nino.mutation(api.mcp.createLessonAsAgent, {
      token,
      requestId: "lesson-1",
      weekId,
      title: "Your first page",
      blocks: [{ type: "text", md: "Every page starts with `<html>`." }],
    });
    await nino.mutation(api.mcp.addLessonBlocksAsAgent, {
      token,
      lessonId,
      blocks: [{ type: "check", check: { kind: "short", prompt: "Which tag wraps the page?", accepted: ["html", "<html>"] } }],
    });
    const quizId = await nino.mutation(api.mcp.createAssessmentAsAgent, { token, courseId, kind: "quiz", title: "Quiz 1", weekId });
    const outline = await nino.query(api.mcp.getCourseOutline, { token, courseId });
    expect(outline.weeks).toEqual([
      expect.objectContaining({
        title: "Week 1 · HTML",
        lessons: [expect.objectContaining({ _id: lessonId, blockCount: 2, createdVia: "mcp", status: "draft" })],
        assessments: [expect.objectContaining({ _id: quizId })],
      }),
    ]);

    // Publishing stays with the lecturer, and then the agent can't edit the published week or lesson.
    await nino.mutation(api.weeks.publish, { weekId });
    await expectAppError(nino.mutation(api.mcp.updateWeekAsAgent, { token, weekId, title: "Renamed" }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.setLessonBlocksAsAgent, { token, lessonId, blocks: [] }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.deleteWeekAsAgent, { token, weekId }), "CONFLICT");
    // But it may still draft a new lesson there; students don't see it until the lecturer publishes it.
    const extra = await nino.mutation(api.mcp.createLessonAsAgent, { token, weekId, title: "Extra", blocks: [{ type: "text", md: "x" }] });
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].lessons.map((l) => l._id)).toEqual([lessonId]);
    void extra;
  });

  test("agents can't reach another lecturer's course", async () => {
    const { t, nino, courseId, universityId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const levan = t.withIdentity({
      issuer: "https://test.clerk.accounts.dev",
      subject: "levan",
      tokenIdentifier: "https://test.clerk.accounts.dev|levan",
      email: "levan@example.com",
      emailVerified: true,
    });
    const levanId = await levan.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: levanId, role: "lecturer", universityId });
    });
    const token = await credential("levan");
    await expectAppError(levan.query(api.mcp.getCourseOutline, { token, courseId }), "NOT_FOUND");
    await expectAppError(levan.mutation(api.mcp.createLessonAsAgent, { token, weekId, title: "Nope" }), "NOT_FOUND");
    void (weekId as Id<"weeks">);
  });
});

describe("agents tidying an outline", () => {
  test("drafts move anywhere, but published weeks and lessons keep their order", async () => {
    const { nino, courseId } = await seed();
    const token = await credential("nino");
    const text = [{ type: "text" as const, md: "x" }];
    const w1 = await nino.mutation(api.weeks.create, { courseId, title: "Week 1" });
    const a1 = await nino.mutation(api.lessons.create, { weekId: w1, title: "A1", blocks: text });
    const a2 = await nino.mutation(api.lessons.create, { weekId: w1, title: "A2", blocks: text });
    const w2 = await nino.mutation(api.weeks.create, { courseId, title: "Week 2" });
    await nino.mutation(api.lessons.create, { weekId: w2, title: "B1", blocks: text });
    await nino.mutation(api.weeks.publish, { weekId: w1 });
    await nino.mutation(api.weeks.publish, { weekId: w2 });
    const w3 = await nino.mutation(api.mcp.createWeekAsAgent, { token, courseId, title: "Extra week" });

    // Weeks: a draft may go first; swapping two published weeks is the lecturer's call.
    await nino.mutation(api.mcp.reorderWeeksAsAgent, { token, courseId, weekIds: [w3, w1, w2] });
    await expectAppError(nino.mutation(api.mcp.reorderWeeksAsAgent, { token, courseId, weekIds: [w3, w2, w1] }), "CONFLICT");
    await nino.mutation(api.weeks.reorder, { courseId, weekIds: [w3, w2, w1] });

    // Lessons: the same, inside a published week.
    const draft = await nino.mutation(api.mcp.createLessonAsAgent, { token, weekId: w1, title: "Draft", blocks: text });
    await nino.mutation(api.mcp.reorderLessonsAsAgent, { token, weekId: w1, lessonIds: [draft, a1, a2] });
    await expectAppError(nino.mutation(api.mcp.reorderLessonsAsAgent, { token, weekId: w1, lessonIds: [a2, a1, draft] }), "CONFLICT");
    await expectAppError(nino.mutation(api.mcp.reorderLessonsAsAgent, { token, weekId: w1, lessonIds: [a1, a2] }), "INVALID_INPUT");
    const outline = await nino.query(api.mcp.getCourseOutline, { token, courseId });
    expect(outline.weeks.map((w) => w.title)).toEqual(["Extra week", "Week 2", "Week 1"]);
    expect(outline.weeks[2].lessons.map((l) => l.title)).toEqual(["Draft", "A1", "A2"]);

    // A hidden week still holding lessons the lecturer published isn't the agent's to delete.
    await nino.mutation(api.weeks.unpublish, { weekId: w2 });
    await expectAppError(nino.mutation(api.mcp.deleteWeekAsAgent, { token, weekId: w2 }), "CONFLICT");
    await nino.mutation(api.mcp.deleteWeekAsAgent, { token, weekId: w3 });
  });

  test("links, course details, deleting drafts and moving work into Exams", async () => {
    const { nino, courseId, quiz } = await seed();
    const token = await credential("nino");
    const weekId = await nino.mutation(api.mcp.createWeekAsAgent, {
      token,
      courseId,
      links: [
        { title: "One", url: "https://one.example.com" },
        { title: "Two", url: "https://two.example.com" },
      ],
    });
    const [one, two] = (await nino.query(api.mcp.getCourseOutline, { token, courseId })).weeks[0].links.map((l) => l.id);
    await nino.mutation(api.mcp.updateWeekLinkAsAgent, { token, weekId, linkId: one, link: { title: "First", url: "https://first.example.com" } });
    await expectAppError(
      nino.mutation(api.mcp.updateWeekLinkAsAgent, { token, weekId, linkId: one, link: { title: "x", url: "http://plain.example.com" } }),
      "INVALID_INPUT",
    );
    await nino.mutation(api.mcp.reorderWeekLinksAsAgent, { token, weekId, linkIds: [two, one] });
    expect((await nino.query(api.mcp.getCourseOutline, { token, courseId })).weeks[0].links).toEqual([
      expect.objectContaining({ id: two, title: "Two" }),
      expect.objectContaining({ id: one, title: "First", url: "https://first.example.com/" }),
    ]);

    // Course details: only while the course is a draft (the seeded one is published).
    await expectAppError(nino.mutation(api.mcp.updateCourseAsAgent, { token, courseId, title: "Renamed" }), "CONFLICT");
    const draftCourse = await nino.mutation(api.mcp.createCourseAsAgent, { token, title: "Draft course" });
    await nino.mutation(api.mcp.updateCourseAsAgent, { token, courseId: draftCourse, title: "CSS basics", semester: "Spring 2027" });
    expect(await nino.query(api.mcp.getCourse, { token, courseId: draftCourse })).toMatchObject({ title: "CSS basics", semester: "Spring 2027" });

    // A quiz turned into a midterm leaves its week for the Exams section.
    const quizId = await nino.mutation(api.mcp.createAssessmentAsAgent, { token, courseId, kind: "quiz", title: "Check", weekId });
    expect((await nino.query(api.mcp.getCourse, { token, courseId })).assessments).toContainEqual(
      expect.objectContaining({ _id: quizId, weekId }),
    );
    await nino.mutation(api.mcp.updateAssessmentAsAgent, { token, assessmentId: quizId, kind: "midterm" });
    const outline = await nino.query(api.mcp.getCourseOutline, { token, courseId });
    expect(outline.weeks[0].assessments).toEqual([]);
    expect(outline.exams.map((e) => e._id)).toContain(quizId);

    // Deleting: drafts only.
    await nino.mutation(api.mcp.deleteAssessmentAsAgent, { token, assessmentId: quizId });
    const { assessmentId: published } = await quiz("Published quiz");
    await expectAppError(nino.mutation(api.mcp.deleteAssessmentAsAgent, { token, assessmentId: published }), "CONFLICT");
  });
});
