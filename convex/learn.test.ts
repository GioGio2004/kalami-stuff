/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionArgs, UserIdentity } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import type { CodeQuestionInput } from "./lib/validators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://test.clerk.accounts.dev";
const FIRST_PAGE = { numItems: 100, cursor: null };

function person(name: string): Partial<UserIdentity> {
  return {
    issuer: ISSUER,
    subject: name,
    tokenIdentifier: `${ISSUER}|${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    givenName: name,
  } as Partial<UserIdentity>;
}

/** The auto-submit cron, then the grading it scheduled (one mutation per attempt). */
async function runAutoSubmit(t: ReturnType<typeof convexTest>): Promise<number> {
  vi.useFakeTimers();
  try {
    const due = await t.mutation(internal.learn.autoSubmit, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return due;
  } finally {
    vi.useRealTimers();
  }
}

async function expectAppError(call: Promise<unknown>, code: string) {
  try {
    await call;
  } catch (error) {
    expect((error as { data?: { code?: string } }).data?.code).toBe(code);
    return;
  }
  throw new Error(`Expected a ${code} error, but the call succeeded`);
}

const PROFILE_CARD: CodeQuestionInput = {
  type: "code",
  prompt: "Build a profile card, one step at a time.",
  points: 10,
  starterFiles: [
    {
      name: "index.html",
      content: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Me</title>\n</head>\n<body>\n\n</body>\n</html>\n',
    },
    { name: "style.css", content: "" },
  ],
  steps: [
    {
      title: "Link your CSS",
      instructions: "Add `<link rel=\"stylesheet\" href=\"style.css\">` inside `<head>`.",
      checks: [{ label: "style.css is linked", type: "linked", href: "style.css" }],
    },
    {
      title: "Add a card",
      instructions: 'Inside `<body>`, add `<div class="card">` with an `<h1>` holding your name.',
      hint: "Classes go in the class attribute, without the dot.",
      checks: [
        { label: "There is a .card", type: "exists", selector: ".card" },
        { label: "The card has an h1", type: "exists", selector: ".card h1" },
      ],
    },
    {
      title: "Make it flex",
      instructions: "In style.css, give `.card` `display: flex`.",
      checks: [{ label: ".card uses flex", type: "css", selector: ".card", property: "display", equals: "flex" }],
    },
  ],
  hiddenChecks: [{ label: "The h1 isn't empty", type: "text", selector: ".card h1", contains: "a" }],
  solution: [
    {
      name: "index.html",
      content:
        '<!DOCTYPE html>\n<html>\n<head>\n  <title>Me</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <div class="card"><h1>Ana</h1></div>\n</body>\n</html>\n',
    },
    { name: "style.css", content: ".card { display: flex; }" },
  ],
};

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const gori = await admin.mutation(api.universities.create, { nameKa: "გორი", nameEn: "Gori State", slug: "gori" });
  const tbilisi = await admin.mutation(api.universities.create, {
    nameKa: "თბილისი",
    nameEn: "Tbilisi State",
    slug: "tbilisi",
  });

  const nino = t.withIdentity(person("nino"));
  const ninoId = await nino.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId: ninoId, role: "lecturer", universityId: gori });
  });

  async function student(name: string, universityId: Id<"universities">) {
    const identity = t.withIdentity(person(name));
    await identity.mutation(api.users.store, {});
    await identity.mutation(api.users.completeStudentOnboarding, {
      firstName: name,
      lastName: "S",
      universityId,
      faculty: "CS",
      group: "CS-1",
      year: 1,
      locale: "ka",
      honestyVersion: HONESTY_NOTICE.version,
    });
    return identity;
  }

  const ana = await student("ana", gori);
  const giorgi = await student("giorgi", tbilisi);

  const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
  const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "task", title: "Profile card" });
  return { t, nino, ana, giorgi, courseId, assessmentId };
}

describe("code tasks in the studio", () => {
  test("a task whose solution fails a check is refused", async () => {
    const { nino, assessmentId } = await setup();
    const broken = { ...PROFILE_CARD, solution: [PROFILE_CARD.solution[0]] };
    await expectAppError(nino.mutation(api.questions.add, { assessmentId, questions: [broken] }), "INVALID_INPUT");
    await expectAppError(
      nino.mutation(api.questions.add, {
        assessmentId,
        questions: [{ ...PROFILE_CARD, steps: [{ ...PROFILE_CARD.steps[0], checks: [{ label: "x", type: "exists", selector: "nav >" }] }] }],
      }),
      "INVALID_INPUT",
    );
    const [id] = await nino.mutation(api.questions.add, { assessmentId, questions: [PROFILE_CARD] });
    const detail = await nino.query(api.assessments.get, { assessmentId });
    const question = detail.questions.find((q) => q._id === id)!;
    expect(question.code?.steps.map((s) => s.checks.map((c) => c.id))).toEqual([["s1c1"], ["s2c1", "s2c2"], ["s3c1"]]);
    expect(question.key).toMatchObject({ type: "code", hiddenChecks: [{ id: "h1" }] });
  });
});


describe("students and code tasks", () => {
  async function published(question: CodeQuestionInput = PROFILE_CARD) {
    const ctx = await setup();
    const { nino, courseId, assessmentId } = ctx;
    const [questionId] = await nino.mutation(api.questions.add, { assessmentId, questions: [question] });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await nino.mutation(api.courses.update, { courseId, status: "published" });
    const course = await nino.query(api.courses.get, { courseId });
    return { ...ctx, questionId, joinCode: course.joinCode };
  }

  test("joining needs a published course in the student's university", async () => {
    const { nino, ana, giorgi, courseId, joinCode } = await published();
    await nino.mutation(api.courses.update, { courseId, status: "draft" });
    expect(await ana.mutation(api.learn.join, { code: joinCode })).toMatchObject({ ok: false });
    await nino.mutation(api.courses.update, { courseId, status: "published" });
    expect(await giorgi.mutation(api.learn.join, { code: joinCode })).toEqual({
      ok: false,
      message: "This course belongs to another university.",
    });
    expect(await ana.mutation(api.learn.join, { code: ` ${joinCode.toLowerCase()} ` })).toEqual({ ok: true, courseId });
    // Joining twice is fine.
    expect(await ana.mutation(api.learn.join, { code: joinCode })).toEqual({ ok: true, courseId });
    expect(await ana.query(api.learn.myCourses, {})).toMatchObject([{ _id: courseId, title: "Web basics", openCount: 1 }]);
    expect(await ana.query(api.learn.upNext, {})).toMatchObject([{ title: "Profile card", started: false }]);
    await expectAppError(nino.query(api.learn.myCourses, {}), "FORBIDDEN");
  });

  test("guessing join codes is paused after 8 wrong tries", async () => {
    const { ana, joinCode } = await published();
    for (let i = 0; i < 8; i++) {
      expect(await ana.mutation(api.learn.join, { code: "ZZZZZZ" })).toMatchObject({ ok: false });
    }
    const blocked = await ana.mutation(api.learn.join, { code: joinCode });
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.ok === false && blocked.message).toMatch(/Too many wrong codes/);
  });

  test("work through the steps, submit, get a score and red-pen notes", async () => {
    const { nino, ana, courseId, assessmentId, questionId, joinCode } = await published();
    await ana.mutation(api.learn.join, { code: joinCode });

    const view = await ana.query(api.learn.course, { courseId });
    expect(view.assessments).toMatchObject([{ _id: assessmentId, kind: "task", state: "open", playable: true, result: null }]);

    const task = await ana.query(api.learn.task, { assessmentId });
    expect(task.questions[0].code.steps).toHaveLength(3);
    // Neither the solution nor hidden checks reach the student.
    expect(JSON.stringify(task)).not.toContain("hiddenChecks\":[{");
    expect(JSON.stringify(task)).not.toContain("<h1>Ana</h1>");

    const starter = task.questions[0].code.files;
    const linked = starter.map((f) =>
      f.name === "index.html"
        ? { ...f, content: f.content.replace("</head>", '<link rel="stylesheet" href="style.css">\n</head>') }
        : f,
    );
    const saved = await ana.mutation(api.learn.saveCodeWork, {
      assessmentId,
      questionId,
      files: linked,
      integrity: { pasteBlocked: 2, dropBlocked: 0, largeInserts: 0 },
    });
    expect(saved.progress).toEqual({ step: 1, passed: ["s1c1"] });
    await ana.mutation(api.learn.reportIntegrityCounts, { assessmentId, counts: { tabSwitches: 3, awayMs: 25_000 } });

    const withCard = linked.map((f) =>
      f.name === "index.html" ? { ...f, content: f.content.replace("<body>", '<body>\n<div class="card"><h1>Ana</h1></div>') } : f,
    );
    expect(
      (await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: withCard })).progress.step,
    ).toBe(2);

    await ana.mutation(api.learn.submit, { assessmentId });
    const after = await ana.query(api.learn.task, { assessmentId });
    // 4 of 5 checks pass (no flex yet): 10 × 4/5.
    expect(after.attempt).toMatchObject({ status: "submitted", score: 8, maxScore: 10, autoSubmitted: false });
    // Results "score": visible check results only, hidden ones stay hidden.
    expect(after.responses[0].checkResults?.map((r) => r.id)).toEqual(["s1c1", "s2c1", "s2c2", "s3c1"]);
    expect(after.hiddenChecks).toEqual([]);
    expect(await ana.query(api.learn.upNext, {})).toEqual([]);
    await expectAppError(
      ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: withCard }),
      "CONFLICT",
    );

    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    // 3 tab switches × 2 + 25 s away (2) + 2 blocked pastes = 10: yellow.
    expect(rows).toMatchObject([
      {
        student: "ana S",
        status: "submitted",
        score: 8,
        stepsDone: 2,
        stepsTotal: 3,
        integrity: { pasteBlocked: 2, tabSwitches: 3, awayMs: 25_000 },
        integrityScore: 10,
        integrityColor: "yellow",
      },
    ]);
    const { attemptId } = rows[0];
    const detail = await nino.query(api.submissions.detail, { attemptId });
    expect(detail.questions[0].checkResults).toHaveLength(5);
    expect(detail.questions[0].hiddenChecks).toHaveLength(1);

    await nino.mutation(api.submissions.addComment, {
      attemptId,
      questionId,
      file: "style.css",
      line: 1,
      text: "Your .card rule is missing: no flex yet.",
    });
    await expectAppError(
      nino.mutation(api.submissions.addComment, { attemptId, questionId, file: "app.js", line: 1, text: "x" }),
      "INVALID_INPUT",
    );
    await nino.mutation(api.submissions.setGrade, { attemptId, feedback: "Good start.", manualScore: 9 });
    const graded = await ana.query(api.learn.task, { assessmentId });
    expect(graded.attempt).toMatchObject({ score: 9, feedback: "Good start." });
    expect(graded.comments).toMatchObject([{ file: "style.css", line: 1, author: "nino" }]);
    await expectAppError(ana.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE }), "FORBIDDEN");
    await expectAppError(nino.mutation(api.submissions.setGrade, { attemptId, manualScore: 11 }), "INVALID_INPUT");
  });

  test("students can't save files the task doesn't have, or open drafts", async () => {
    const { nino, ana, courseId, assessmentId, questionId, joinCode } = await published();
    await ana.mutation(api.learn.join, { code: joinCode });
    const saved = await ana.mutation(api.learn.saveCodeWork, {
      assessmentId,
      questionId,
      files: [{ name: "hack.html", content: "x" }],
    });
    expect(saved.progress.step).toBe(0);
    const task = await ana.query(api.learn.task, { assessmentId });
    expect(task.responses[0].files.map((f) => f.name)).toEqual(["index.html", "style.css"]);

    const draft = await nino.mutation(api.assessments.create, { courseId, kind: "task", title: "Draft" });
    await expectAppError(ana.query(api.learn.task, { assessmentId: draft }), "NOT_FOUND");
  });

  test("work left in progress is submitted when the task closes", async () => {
    const { t, nino, ana, assessmentId, questionId, joinCode } = await published();
    await ana.mutation(api.learn.join, { code: joinCode });
    const task = await ana.query(api.learn.task, { assessmentId });
    await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: task.questions[0].code.files });
    expect(await runAutoSubmit(t)).toBe(0);
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 1000 } });
    expect(await runAutoSubmit(t)).toBe(1);
    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(rows).toMatchObject([{ status: "submitted", autoSubmitted: true, score: 0 }]);
  });

  test("each student gets their own variant, and their own name in checks", async () => {
    const colorful: CodeQuestionInput = {
      type: "code",
      prompt: "Make the heading {{color}}.",
      points: 2,
      variables: [{ name: "color", values: ["red", "teal", "navy", "olive", "purple"] }],
      starterFiles: [{ name: "index.html", content: "<h1></h1>" }],
      steps: [
        {
          title: "Your name in {{color}}",
          instructions: "Write your first name in the h1 and colour it {{color}} with a style attribute.",
          checks: [
            { label: "The h1 says {{student.firstName}}", type: "text", selector: "h1", contains: "{{student.firstName}}" },
            { label: "The h1 is {{color}}", type: "css", selector: "h1", property: "color", equals: "{{color}}" },
          ],
        },
      ],
      solution: [{ name: "index.html", content: '<h1 style="color: {{color}}">{{student.firstName}}</h1>' }],
    };
    const { nino, ana, assessmentId, joinCode, questionId } = await published(colorful);
    await ana.mutation(api.learn.join, { code: joinCode });
    const task = await ana.query(api.learn.task, { assessmentId });
    const { prompt, code } = task.questions[0];
    const color = /Make the heading (\w+)\./.exec(prompt)![1];
    expect(colorful.variables![0].values).toContain(color);
    expect(code.steps[0].checks[1]).toMatchObject({ equals: color });
    expect(code.steps[0].checks[0]).toMatchObject({ contains: "ana" });
    expect(JSON.stringify(task)).not.toContain("purple\",\"");

    const files = [{ name: "index.html", content: `<h1 style="color: ${color}">ana</h1>` }];
    expect((await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files })).progress.step).toBe(1);
    await ana.mutation(api.learn.submit, { assessmentId });
    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(rows[0].score).toBe(2);

    // An unknown placeholder, or a solution that only works for one colour, is refused.
    const typo = { ...colorful, prompt: "Make it {{colour}}" };
    await expectAppError(nino.mutation(api.questions.add, { assessmentId, questions: [typo] }), "INVALID_INPUT");
  });
});

describe("students and quizzes", () => {
  const QUESTIONS = [
    {
      type: "single" as const,
      prompt: "Which tag makes a link?",
      points: 2,
      options: [
        { text: "<a>", correct: true },
        { text: "<link>", correct: false },
        { text: "<href>", correct: false },
      ],
    },
    {
      type: "multiple" as const,
      prompt: "Which are block elements?",
      points: 1,
      options: [
        { text: "<div>", correct: true },
        { text: "<span>", correct: false },
        { text: "<p>", correct: true },
      ],
    },
    { type: "short" as const, prompt: "What does CSS stand for?", points: 1.5, acceptedAnswers: ["Cascading Style Sheets"] },
    { type: "essay" as const, prompt: "Why do semantic tags matter?", points: 3 },
  ];

  async function quiz(settings: Record<string, unknown> = {}) {
    const ctx = await setup();
    const { nino, ana, courseId } = ctx;
    const quizId = await nino.mutation(api.assessments.create, { courseId, kind: "quiz", title: "Quiz 1" });
    await nino.mutation(api.assessments.update, { assessmentId: quizId, settings });
    const questionIds = await nino.mutation(api.questions.add, { assessmentId: quizId, questions: QUESTIONS });
    await nino.mutation(api.assessments.setStatus, { assessmentId: quizId, status: "published" });
    await nino.mutation(api.courses.update, { courseId, status: "published" });
    const { joinCode } = await nino.query(api.courses.get, { courseId });
    await ana.mutation(api.learn.join, { code: joinCode });
    return { ...ctx, quizId, questionIds };
  }

  test("questions stay hidden until Start, answers are graded on submit, essays wait for the lecturer", async () => {
    const { nino, ana, courseId, quizId, questionIds } = await quiz({
      timeLimitMin: 20,
      attemptsAllowed: 2,
      resultsVisibility: "full_after_close",
      shuffleQuestions: false,
    });
    const [single, multiple, short, essay] = questionIds;

    const before = await ana.query(api.learn.quiz, { assessmentId: quizId });
    expect(before).toMatchObject({ attempt: null, attemptsUsed: 0, questions: [], assessment: { questionCount: 4, totalPoints: 7.5 } });
    expect(JSON.stringify(before)).not.toContain("Which tag");
    expect((await ana.query(api.learn.course, { courseId })).assessments[0]).toMatchObject({ kind: "quiz", playable: true });
    await expectAppError(
      ana.mutation(api.learn.saveQuizAnswer, { assessmentId: quizId, questionId: short, answer: { type: "short", text: "x" } }),
      "CONFLICT",
    );

    const attemptId = await ana.mutation(api.learn.startAttempt, { assessmentId: quizId });
    expect(await ana.mutation(api.learn.startAttempt, { assessmentId: quizId })).toBe(attemptId);
    const running = await ana.query(api.learn.quiz, { assessmentId: quizId });
    expect(running.questions.map((q) => q._id)).toEqual(questionIds);
    expect(running.attempt!.deadlineAt! - running.attempt!.startedAt).toBe(20 * 60_000);
    // No keys while it runs.
    expect(running.review).toEqual([]);
    expect(JSON.stringify(running)).not.toContain("correct");

    const option = (questionId: Id<"questions">, text: string) =>
      running.questions.find((q) => q._id === questionId)!.options!.find((o) => o.text === text)!.id;
    const save = (questionId: Id<"questions">, answer: FunctionArgs<typeof api.learn.saveQuizAnswer>["answer"]) =>
      ana.mutation(api.learn.saveQuizAnswer, { assessmentId: quizId, questionId, answer });
    await save(single, { type: "single", optionId: option(single, "<link>") });
    await save(single, { type: "single", optionId: option(single, "<a>") });
    await save(multiple, { type: "multiple", optionIds: [option(multiple, "<p>"), option(multiple, "<div>")] });
    await save(short, { type: "short", text: "  cascading   style sheets " });
    await save(essay, { type: "essay", text: "They tell browsers and screen readers what things are." });
    await expectAppError(save(single, { type: "short", text: "<a>" }), "INVALID_INPUT");
    await expectAppError(save(single, { type: "single", optionId: "nope" }), "INVALID_INPUT");

    await ana.mutation(api.learn.submit, { assessmentId: quizId });
    const done = await ana.query(api.learn.quiz, { assessmentId: quizId });
    // 2 + 1 + 1.5; the essay waits.
    expect(done.attempt).toMatchObject({ status: "submitted", score: 4.5, pendingGrading: true, autoSubmitted: false });
    expect(done.review.find((r) => r.questionId === single)).toMatchObject({ points: 2, correctOptionIds: [option(single, "<a>")] });
    expect(done.review.find((r) => r.questionId === short)).toMatchObject({ acceptedAnswers: ["Cascading Style Sheets"] });
    expect(done.review.find((r) => r.questionId === essay)?.points).toBeUndefined();

    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId: quizId, paginationOpts: FIRST_PAGE })).page;
    expect(row).toMatchObject({ number: 1, answered: 4, questionsTotal: 4, needsGrading: true, score: 4.5 });
    const detail = await nino.query(api.submissions.detail, { attemptId });
    expect(detail.answers.map((a) => a.type)).toEqual(["single", "multiple", "short", "essay"]);
    expect(detail.answers[0]).toMatchObject({ autoScore: 2, key: { type: "single" } });

    await expectAppError(
      nino.mutation(api.submissions.setQuestionPoints, { attemptId, questionId: essay, points: 4 }),
      "INVALID_INPUT",
    );
    await nino.mutation(api.submissions.setQuestionPoints, { attemptId, questionId: essay, points: 2.5 });
    expect((await ana.query(api.learn.quiz, { assessmentId: quizId })).attempt).toMatchObject({ score: 7, pendingGrading: false });
    expect(((await nino.query(api.submissions.forAssessment, { assessmentId: quizId, paginationOpts: FIRST_PAGE })).page)[0].needsGrading).toBe(false);

    // A second try, allowed by the settings, starts empty; the best score counts.
    const second = await ana.mutation(api.learn.startAttempt, { assessmentId: quizId });
    expect(second).not.toBe(attemptId);
    const retry = await ana.query(api.learn.quiz, { assessmentId: quizId });
    expect(retry).toMatchObject({ attemptsUsed: 2, attempt: { number: 2, status: "in_progress" }, answers: [] });
    await ana.mutation(api.learn.submit, { assessmentId: quizId });
    expect((await ana.query(api.learn.course, { courseId })).assessments[0].result).toMatchObject({ status: "submitted", score: 7 });
    await expectAppError(ana.mutation(api.learn.startAttempt, { assessmentId: quizId }), "CONFLICT");
  });

  test("a timed attempt stops taking answers when time is up and is submitted for the student", async () => {
    const closesAt = Date.now() + 5 * 60_000;
    const { t, nino, ana, quizId, questionIds } = await quiz({ timeLimitMin: 60, closesAt, resultsVisibility: "score" });
    const attemptId = await ana.mutation(api.learn.startAttempt, { assessmentId: quizId });
    // The time limit never runs past the closing time.
    expect((await ana.query(api.learn.quiz, { assessmentId: quizId })).attempt?.deadlineAt).toBe(closesAt);
    await ana.mutation(api.learn.saveQuizAnswer, {
      assessmentId: quizId,
      questionId: questionIds[2],
      answer: { type: "short", text: "Cascading Style Sheets" },
    });

    await t.run((ctx) => ctx.db.patch("attempts", attemptId, { deadlineAt: Date.now() - 60_000 }));
    await expectAppError(
      ana.mutation(api.learn.saveQuizAnswer, {
        assessmentId: quizId,
        questionId: questionIds[3],
        answer: { type: "essay", text: "late" },
      }),
      "CONFLICT",
    );
    expect(await runAutoSubmit(t)).toBe(1);
    const after = await ana.query(api.learn.quiz, { assessmentId: quizId });
    // "Score only": the score, but not the questions.
    expect(after).toMatchObject({ attempt: { status: "submitted", autoSubmitted: true, score: 1.5 }, questions: [], review: [] });
    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId: quizId, paginationOpts: FIRST_PAGE })).page;
    expect(rows).toMatchObject([{ autoSubmitted: true, answered: 1 }]);
  });

  test("shuffled quizzes keep one order per student", async () => {
    const { ana, quizId, questionIds } = await quiz({ shuffleQuestions: true, shuffleOptions: true });
    await ana.mutation(api.learn.startAttempt, { assessmentId: quizId });
    const first = await ana.query(api.learn.quiz, { assessmentId: quizId });
    const again = await ana.query(api.learn.quiz, { assessmentId: quizId });
    expect(again.questions).toEqual(first.questions);
    expect([...first.questions.map((q) => q._id)].sort()).toEqual([...questionIds].sort());
    expect(first.questions.find((q) => q.type === "single")!.options!.map((o) => o.text).sort()).toEqual(["<a>", "<href>", "<link>"]);
  });
});
