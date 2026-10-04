/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { expectAppError, seed, settle } from "./test.setup";

const FIRST_PAGE = { numItems: 100, cursor: null };

/** The auto-submit cron, then the grading it scheduled. */
async function runAutoSubmit(t: Awaited<ReturnType<typeof seed>>["t"]): Promise<number> {
  vi.useFakeTimers();
  try {
    const due = await t.mutation(internal.learn.autoSubmit, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return due;
  } finally {
    vi.useRealTimers();
  }
}

describe("deadlines", () => {
  test("a save a few seconds after the closing time still lands; a late one doesn't", async () => {
    const { t, nino, ana, quiz } = await seed();
    const { assessmentId, questionId } = await quiz("Quiz", { closesAt: Date.now() + 60_000 });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    const answer = { type: "short" as const, text: "Cascading Style Sheets" };

    // Closed five seconds ago: inside the grace period, the same as a time limit gives.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 5_000 } });
    await ana.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId, answer });
    expect(await runAutoSubmit(t)).toBe(0);

    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 30_000 } });
    await expectAppError(ana.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId, answer }), "CONFLICT");
    expect(await runAutoSubmit(t)).toBe(1);
    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(row).toMatchObject({ status: "submitted", autoSubmitted: true, score: 1 });
  });

  test("the countdown gets the server's clock", async () => {
    const { ana, quiz } = await seed();
    const { assessmentId } = await quiz("Quiz");
    const before = Date.now();
    const view = await ana.query(api.learn.quiz, { assessmentId });
    expect(view.serverNow).toBeGreaterThanOrEqual(before);
    expect(view.serverNow).toBeLessThanOrEqual(Date.now());
  });
});

describe("editing after students started", () => {
  test("questions are frozen except for text edits that keep the option ids", async () => {
    const { t, nino, ana, quiz } = await seed();
    const { assessmentId, questionId } = await quiz("Quiz");
    const [choice] = await nino.mutation(api.questions.add, {
      assessmentId,
      questions: [
        {
          type: "single",
          prompt: "Which tag makes a link?",
          options: [
            { text: "<a>", correct: true },
            { text: "<link>", correct: false },
          ],
        },
      ],
    });
    const idsBefore = (await nino.query(api.assessments.get, { assessmentId })).questions.find((q) => q._id === choice)!.options!.map((o) => o.id);

    await ana.mutation(api.learn.startAttempt, { assessmentId });
    const view = await ana.query(api.learn.quiz, { assessmentId });
    const option = view.questions.find((q) => q._id === choice)!.options!.find((o) => o.text === "<a>")!.id;
    await ana.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId: choice, answer: { type: "single", optionId: option } });
    expect((await nino.query(api.assessments.get, { assessmentId })).started).toBe(1);

    // A typo fix keeps the ids, so the saved answer still points at the right option.
    await nino.mutation(api.questions.update, {
      questionId: choice,
      question: {
        type: "single",
        prompt: "Which tag makes a hyperlink?",
        options: [
          { text: "<a>", correct: true },
          { text: "<link>", correct: false },
        ],
      },
    });
    const after = (await nino.query(api.assessments.get, { assessmentId })).questions.find((q) => q._id === choice)!;
    expect(after.options!.map((o) => o.id)).toEqual(idsBefore);
    expect(after.prompt).toBe("Which tag makes a hyperlink?");

    // Anything that would break saved answers or the shuffled order is refused.
    const refused = [
      () =>
        nino.mutation(api.questions.update, {
          questionId: choice,
          question: {
            type: "single",
            prompt: "x",
            options: [
              { text: "<a>", correct: true },
              { text: "<link>", correct: false },
              { text: "<href>", correct: false },
            ],
          },
        }),
      () => nino.mutation(api.questions.update, { questionId: choice, question: { type: "essay", prompt: "x" } }),
      () => nino.mutation(api.questions.remove, { questionId: choice }),
      () => nino.mutation(api.questions.reorder, { assessmentId, questionIds: [choice, questionId] }),
      () => nino.mutation(api.questions.add, { assessmentId, questions: [{ type: "essay", prompt: "More?" }] }),
      () => nino.mutation(api.assessments.update, { assessmentId, settings: { shuffleQuestions: false } }),
      () => nino.mutation(api.assessments.remove, { assessmentId }),
    ];
    for (const call of refused) {
      await expectAppError(call(), "CONFLICT");
    }
    // Settings that don't touch the questions still change.
    await nino.mutation(api.assessments.update, { assessmentId, title: "Quiz 1", settings: { closesAt: Date.now() + 3_600_000 } });

    await ana.mutation(api.learn.submit, { assessmentId });
    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(row).toMatchObject({ score: 1, maxScore: 2 });
    void t;
  });

  test("the kind is fixed once published", async () => {
    const { nino, quiz } = await seed();
    const { assessmentId } = await quiz("Quiz");
    await expectAppError(nino.mutation(api.assessments.update, { assessmentId, kind: "task" }), "CONFLICT");
  });

  test("taking published work back grades open attempts as they stand", async () => {
    const { t, nino, ana, giorgi, quiz } = await seed();
    const { assessmentId, questionId } = await quiz("Quiz");
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    await ana.mutation(api.learn.saveQuizAnswer, {
      assessmentId,
      questionId,
      answer: { type: "short", text: "Cascading Style Sheets" },
    });
    await giorgi.mutation(api.learn.startAttempt, { assessmentId });

    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "draft" });
    await settle(t);
    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(rows.map((r) => [r.student, r.status, r.autoSubmitted, r.score])).toEqual([
      ["ana S", "submitted", true, 1],
      ["giorgi S", "submitted", true, 0],
    ]);
    // Students can't reach a draft, and the lecturer can't delete work that was done.
    await expectAppError(ana.query(api.learn.quiz, { assessmentId }), "NOT_FOUND");
    await expectAppError(nino.mutation(api.assessments.remove, { assessmentId }), "CONFLICT");
  });
});

describe("grading never gets stuck", () => {
  test("an attempt of a deleted account is still graded", async () => {
    const { t, nino, ana, quiz } = await seed();
    const { assessmentId, questionId } = await quiz("Quiz", { closesAt: Date.now() + 60_000 });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    await ana.mutation(api.learn.saveQuizAnswer, {
      assessmentId,
      questionId,
      answer: { type: "short", text: "Cascading Style Sheets" },
    });
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "ana" });
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 30_000 } });
    expect(await runAutoSubmit(t)).toBe(1);
    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(row).toMatchObject({ student: "Deleted account", status: "submitted", score: 1 });
    // Nothing left for the next run.
    expect(await runAutoSubmit(t)).toBe(0);
  });

  test("grading that keeps getting killed is closed as failed after three tries", async () => {
    const { t, nino, ana, quiz } = await seed();
    const { assessmentId } = await quiz("Quiz", { closesAt: Date.now() + 60_000 });
    const attemptId = await ana.mutation(api.learn.startAttempt, { assessmentId });
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 30_000 } });
    // Three runs the platform killed before they could finish, as the cron would have counted them.
    await t.run(async (ctx) => {
      await ctx.db.patch("attempts", attemptId, { gradingTries: 3 });
    });
    await t.mutation(internal.learn.autoSubmit, {});
    const attempt = await t.run(async (ctx) => ctx.db.get("attempts", attemptId));
    expect(attempt).toMatchObject({ status: "submitted", score: 0, autoSubmitted: true });
    expect(attempt!.gradingError).toMatch(/ran out of time/);
    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(row.gradingError).toBeDefined();
    // The lecturer grades it by hand.
    await nino.mutation(api.submissions.setGrade, { attemptId, manualScore: 1, feedback: "Checked by hand." });
  });

  test("a page too big to check fails its checks instead of hanging", async () => {
    const { nino, ana, courseId, joinCode } = await seed();
    void joinCode;
    const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "task", title: "Task" });
    const [questionId] = await nino.mutation(api.questions.add, {
      assessmentId,
      questions: [
        {
          type: "code",
          prompt: "Make a heading.",
          starterFiles: [{ name: "index.html", content: "<h1></h1>" }],
          steps: [{ title: "Heading", instructions: "Add text.", checks: [{ label: "h1 has text", type: "text", selector: "h1", contains: "a" }] }],
          solution: [{ name: "index.html", content: "<h1>a</h1>" }],
        },
      ],
    });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    const huge = `<h1>a</h1>${"<p></p>".repeat(4500)}`;
    const saved = await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: [{ name: "index.html", content: huge }] });
    expect(saved.progress).toEqual({ step: 0, passed: [] });
    await ana.mutation(api.learn.submit, { assessmentId });
    const view = await ana.query(api.learn.task, { assessmentId });
    expect(view.attempt).toMatchObject({ status: "submitted", score: 0 });
  });
});

describe("deploy guard", () => {
  test("says busy while a timed attempt runs, and clear otherwise", async () => {
    const { t, ana, quiz } = await seed();
    expect(await t.query(internal.ops.deployGuard, {})).toMatchObject({ busy: false });
    const { assessmentId } = await quiz("Midterm", { timeLimitMin: 30 });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    expect(await t.query(internal.ops.deployGuard, {})).toMatchObject({ busy: true });
    await ana.mutation(api.learn.submit, { assessmentId });
    expect(await t.query(internal.ops.deployGuard, {})).toMatchObject({ busy: false });
  });
});

describe("rate limits", () => {
  test("a client saving far faster than a person types is slowed down, not broken", async () => {
    const { ana, quiz } = await seed();
    const { assessmentId, questionId } = await quiz("Quiz");
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    const save = (i: number) =>
      ana.mutation(api.learn.saveQuizAnswer, { assessmentId, questionId, answer: { type: "short", text: `try ${i}` } });
    // The bucket holds 30; the 31st call in the same instant is refused with a retry hint.
    for (let i = 0; i < 30; i++) await save(i);
    try {
      await save(30);
      throw new Error("expected a rate limit");
    } catch (error) {
      const data = (error as { data?: { code?: string; retryAfterMs?: number } }).data;
      expect(data?.code).toBe("RATE_LIMITED");
      expect(data?.retryAfterMs).toBeGreaterThan(0);
    }
    // The work saved so far is untouched.
    expect((await ana.query(api.learn.quizAnswers, { assessmentId })).answers[0].value).toEqual({ type: "short", text: "try 29" });
  });
});
