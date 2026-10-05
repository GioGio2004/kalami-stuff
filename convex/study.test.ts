/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { expectAppError, seed, settle } from "./test.setup";

// The student connector (study.ts): what a student's own assistant may read,
// signed in with the same service credential the staff connector uses.

const SECRET = "test-service-secret-0123456789abcdef";
beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What the student app's lib/mcp/oauth.ts serviceCredential() sends Convex after a sign-in. */
async function credential(clerkUserId: string, secret = SECRET) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

type Env = Awaited<ReturnType<typeof seed>>;

/** A published week with a published lesson and a hidden one, by nino. */
async function lessons(env: Env) {
  const weekId = await env.nino.mutation(api.weeks.create, { courseId: env.courseId });
  const published = await env.nino.mutation(api.lessons.create, {
    weekId,
    title: "The box model",
    blocks: [
      { type: "text", md: "Every element is a **box**: content, padding, border, margin." },
      { type: "callout", tone: "definition", title: "Margin", md: "The space that pushes other boxes away." },
    ],
  });
  const draft = await env.nino.mutation(api.lessons.create, { weekId, title: "Secret draft", blocks: [{ type: "text", md: "margin collapsing" }] });
  await env.nino.mutation(api.lessons.setStatus, { lessonId: published, status: "published" });
  // Publishing a week publishes its lessons; hide the second one again afterwards.
  await env.nino.mutation(api.weeks.publish, { weekId });
  await env.nino.mutation(api.lessons.setStatus, { lessonId: draft, status: "draft" });
  await settle(env.t);
  return { weekId, published, draft };
}

describe("study connector: who gets in", () => {
  test("a student's credential works; staff, strangers and bad credentials don't", async () => {
    const { t, nino } = await seed();
    const ana = await credential("ana");
    expect(await t.query(api.study.whoami, { token: ana })).toMatchObject({ name: "ana S", email: "ana@example.com", locale: "ka", courses: 1 });
    expect((await t.query(api.study.whoami, { token: ana }))?.university).toEqual({ ka: "გორი", en: "Gori State" });

    // A lecturer and the super admin are not students here.
    expect(await t.query(api.study.whoami, { token: await credential("nino") })).toBeNull();
    await expectAppError(t.query(api.study.listCourses, { token: await credential("nino") }), "UNAUTHENTICATED");
    expect(await t.query(api.study.whoami, { token: await credential("admin") })).toBeNull();
    // Nobody, a forged signature, no credential.
    expect(await t.query(api.study.whoami, { token: await credential("ghost") })).toBeNull();
    expect(await t.query(api.study.whoami, { token: await credential("ana", "wrong-secret") })).toBeNull();
    expect(await t.query(api.study.whoami, { token: "svc.nope" })).toBeNull();
    // The staff connector still refuses students.
    expect(await t.query(api.mcp.whoami, { token: ana })).toBeNull();
    void nino;
  });

  test("a student who hasn't finished onboarding is refused", async () => {
    const { t } = await seed();
    const fresh = t.withIdentity({ issuer: "https://test.clerk.accounts.dev", subject: "fresh", tokenIdentifier: "https://test.clerk.accounts.dev|fresh", email: "fresh@example.com", emailVerified: true });
    await fresh.mutation(api.users.store, {});
    expect(await t.query(api.study.whoami, { token: await credential("fresh") })).toBeNull();
  });
});

describe("study connector: courses, lessons and materials", () => {
  test("lists only the courses the student joined, with their weeks, materials and lessons", async () => {
    const env = await seed();
    const { t, courseId } = env;
    const { published, draft } = await lessons(env);
    const ana = await credential("ana");
    const maka = await credential("maka");

    expect((await t.query(api.study.listCourses, { token: ana })).map((c) => c.title)).toEqual(["Web basics"]);
    expect(await t.query(api.study.listCourses, { token: maka })).toEqual([]);

    const course = await t.query(api.study.getCourse, { token: ana, courseId });
    expect(course.title).toBe("Web basics");
    expect(course.weeks).toHaveLength(1);
    expect(course.weeks[0].lessons.map((l) => l.title)).toEqual(["The box model"]);
    await expectAppError(t.query(api.study.getCourse, { token: maka, courseId }), "NOT_FOUND");

    const lesson = await t.query(api.study.getLesson, { token: ana, lessonId: published });
    expect(lesson.title).toBe("The box model");
    expect(lesson.blocks).toHaveLength(2);
    await expectAppError(t.query(api.study.getLesson, { token: ana, lessonId: draft }), "NOT_FOUND");
    await expectAppError(t.query(api.study.getLesson, { token: maka, lessonId: published }), "NOT_FOUND");
  });

  test("find_in_lessons searches published lessons of the student's courses only", async () => {
    const env = await seed();
    const { t } = env;
    await lessons(env);
    const ana = await credential("ana");
    const hits = await t.query(api.study.findInLessons, { token: ana, query: "Margin" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "The box model", weekTitle: expect.any(String), course: { title: "Web basics" } });
    expect(hits[0].snippet).toContain("Margin");
    // The draft lesson's words are not found; a stranger finds nothing; one letter is too short.
    expect(await t.query(api.study.findInLessons, { token: ana, query: "collapsing" })).toEqual([]);
    expect(await t.query(api.study.findInLessons, { token: await credential("maka"), query: "box" })).toEqual([]);
    expect(await t.query(api.study.findInLessons, { token: ana, query: "b" })).toEqual([]);
  });
});

describe("study connector: finished work only", () => {
  test("a quiz is off limits until it's submitted with no retake left, then shows answers per the results setting", async () => {
    const env = await seed();
    const { t, nino, ana: anaApp } = env;
    const ana = await credential("ana");
    const { assessmentId, questionId } = await env.quiz("Quiz 1");

    // Not started.
    let work = await t.query(api.study.getWork, { token: ana, assessmentId });
    expect(work).toMatchObject({ available: false, reason: expect.stringContaining("haven't started") });

    // In progress: nothing of the questions leaks.
    await anaApp.mutation(api.learn.startAttempt, { assessmentId });
    work = await t.query(api.study.getWork, { token: ana, assessmentId });
    expect(work).toMatchObject({ available: false, reason: expect.stringContaining("middle of it") });
    expect(JSON.stringify(work)).not.toContain("CSS stand for");

    // Submitted, one attempt allowed: finished. Results are "full after close" and it's still open: no questions yet.
    await anaApp.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId, answer: { type: "short", text: "Cascading Style Sheets" } });
    await anaApp.mutation(api.learn.submit, { assessmentId });
    await settle(t);
    work = await t.query(api.study.getWork, { token: ana, assessmentId });
    expect(work.available).toBe(true);
    if (work.available && work.kind !== "task") {
      expect(work.questions).toEqual([]);
      expect(work.note).toContain("once this work closes");
      expect(work.attempt.score).toBeUndefined();
    }

    // Closed: the questions, the student's answers, what was right, points and explanation.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 1000 } });
    work = await t.query(api.study.getWork, { token: ana, assessmentId });
    expect(work.available).toBe(true);
    if (work.available && work.kind !== "task") {
      expect(work.assessment.state).toBe("closed");
      expect(work.attempt).toMatchObject({ score: 1, maxScore: 1, attemptsUsed: 1 });
      expect(work.questions).toHaveLength(1);
      expect(work.questions[0]).toMatchObject({
        prompt: "What does CSS stand for?",
        myAnswer: { type: "short", text: "Cascading Style Sheets" },
        pointsEarned: 1,
        acceptedAnswers: ["Cascading Style Sheets"],
      });
      expect(work.note).toBeUndefined();
    }

    // "Score only": closed shows the questions and the student's answers, but no answer key.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { resultsVisibility: "score" } });
    work = await t.query(api.study.getWork, { token: ana, assessmentId });
    if (work.available && work.kind !== "task") {
      expect(work.attempt.score).toBe(1);
      expect(work.questions[0].myAnswer).toEqual({ type: "short", text: "Cascading Style Sheets" });
      expect(work.questions[0].acceptedAnswers).toBeUndefined();
      expect(work.questions[0].pointsEarned).toBeUndefined();
      expect(work.note).toContain("score only");
    }

    // "Hidden": no score either.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { resultsVisibility: "hidden" } });
    work = await t.query(api.study.getWork, { token: ana, assessmentId });
    if (work.available && work.kind !== "task") {
      expect(work.attempt.score).toBeUndefined();
      expect(work.note).toContain("no results");
    }

    // Other students can't see it at all; staff can't use the connector.
    await expectAppError(t.query(api.study.getWork, { token: await credential("maka"), assessmentId }), "NOT_FOUND");
    await expectAppError(t.query(api.study.getWork, { token: await credential("nino"), assessmentId }), "UNAUTHENTICATED");
  });

  test("a submitted quiz with retakes left stays off limits while it's open", async () => {
    const env = await seed();
    const { t, nino, ana: anaApp } = env;
    const ana = await credential("ana");
    const { assessmentId, questionId } = await env.quiz("Retake quiz", { attemptsAllowed: 2 }, false);
    await nino.mutation(api.assessments.update, { assessmentId, settings: { attemptsAllowed: 2, resultsVisibility: "score" } });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await settle(t);
    await anaApp.mutation(api.learn.startAttempt, { assessmentId });
    await anaApp.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId, answer: { type: "short", text: "wrong" } });
    await anaApp.mutation(api.learn.submit, { assessmentId });
    await settle(t);

    const work = await t.query(api.study.getWork, { token: ana, assessmentId });
    expect(work).toMatchObject({ available: false, reason: expect.stringContaining("1 attempt left") });
    expect(JSON.stringify(work)).not.toContain("CSS stand for");

    const progress = await t.query(api.study.progress, { token: ana });
    expect(progress).toHaveLength(1);
    expect(progress[0].work.find((w) => w._id === assessmentId)).toMatchObject({ status: "submitted", score: 0, finished: false });
    // Closed: finished, whatever attempts were left.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 1000 } });
    expect((await t.query(api.study.getWork, { token: ana, assessmentId })).available).toBe(true);
    expect((await t.query(api.study.progress, { token: ana }))[0].work.find((w) => w._id === assessmentId)?.finished).toBe(true);
  });

  test("progress and what's next follow the student app", async () => {
    const env = await seed();
    const { t } = env;
    await env.quiz("Open quiz");
    const ana = await credential("ana");
    const next = await t.query(api.study.upNext, { token: ana });
    expect(next.map((item) => item.title)).toEqual(["Open quiz"]);
    const progress = await t.query(api.study.progress, { token: ana });
    expect(progress[0].course.title).toBe("Web basics");
    expect(progress[0].work).toEqual([
      expect.objectContaining({ title: "Open quiz", kind: "quiz", state: "open", status: "not_started", finished: false, totalPoints: 1 }),
    ]);
    expect(await t.query(api.study.progress, { token: await credential("maka") })).toEqual([]);
  });
});
