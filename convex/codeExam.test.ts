/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { CodeQuestionInput } from "./lib/validators";
import { expectAppError, seed, settle } from "./test.setup";

/**
 * A coding midterm end to end (TASK-025/026, 2026-11-05): the questions only
 * after Start, every check graded on submit, untouched work scoring nothing,
 * notes waiting for the results, and fixing a check after students started.
 */

const FIRST_PAGE = { numItems: 100, cursor: null };

const STARTER = '<!DOCTYPE html>\n<html>\n<head>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <button class="btn">Go</button>\n</body>\n</html>\n';

const BUTTON: CodeQuestionInput = {
  type: "code",
  prompt: "Make the button feel alive.",
  points: 4,
  starterFiles: [
    { name: "index.html", content: STARTER },
    { name: "style.css", content: "" },
  ],
  steps: [
    {
      title: "Colour",
      instructions: "Give `.btn` a lime background.",
      checks: [{ label: "The button is lime", type: "css", selector: ".btn", property: "background-color", equals: "#c6f432" }],
    },
    {
      title: "Hover",
      instructions: "Hovered, it turns black.",
      checks: [{ label: "Hovered, it is black", type: "css", selector: ".btn:hover", property: "background-color", equals: "black" }],
    },
  ],
  hiddenChecks: [{ label: "It pulses", type: "animation", selector: ".btn", property: "transform" }],
  solution: [
    { name: "index.html", content: STARTER },
    {
      name: "style.css",
      content:
        ".btn { background: #c6f432; animation: pulse 1s infinite; }\n.btn:hover { background: #000; }\n@keyframes pulse { 50% { transform: scale(1.05); } }",
    },
  ],
};

async function midterm(settings: Record<string, unknown> = {}) {
  const ctx = await seed();
  const { t, nino, courseId } = ctx;
  const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "midterm", title: "Midterm" });
  await nino.mutation(api.assessments.update, { assessmentId, settings: { shuffleQuestions: false, ...settings } });
  const [questionId] = await nino.mutation(api.questions.add, { assessmentId, questions: [BUTTON] });
  await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
  await settle(t);
  return { ...ctx, assessmentId, questionId: questionId as Id<"questions"> };
}

function files(css: string) {
  return [
    { name: "index.html", content: STARTER },
    { name: "style.css", content: css },
  ];
}

describe("a coding midterm", () => {
  test("its code only reaches students after Start, never through the task page", async () => {
    const { ana, assessmentId } = await midterm();
    await expectAppError(ana.query(api.learn.task, { assessmentId }), "NOT_FOUND");
    await expectAppError(ana.query(api.learn.taskWork, { assessmentId }), "NOT_FOUND");
    const before = await ana.query(api.learn.quiz, { assessmentId });
    expect(before.questions).toEqual([]);
    expect(JSON.stringify(before)).not.toContain("lime");
    // Exams grade code on submit and leave the help out unless the lecturer turns it on.
    expect(before.assessment).toMatchObject({ codeChecks: "on_submit", codeHelp: false, codeQuestionCount: 1 });

    await ana.mutation(api.learn.startAttempt, { assessmentId });
    const during = await ana.query(api.learn.quiz, { assessmentId });
    expect(during.questions[0].code?.steps).toHaveLength(2);
    expect(JSON.stringify(during)).not.toContain("It pulses");
  });

  test("every check, hidden ones too, counts on submit; untouched starter files score nothing", async () => {
    const { nino, ana, giorgi, assessmentId, questionId } = await midterm({ resultsVisibility: "score" });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    await ana.mutation(api.learn.saveCodeWork, {
      assessmentId,
      questionId,
      files: files(".btn { background: #c6f432; }\n.btn:hover { background: black; }"),
    });
    await ana.mutation(api.learn.submit, { assessmentId });

    // Giorgi starts and leaves the starter files as they are.
    await giorgi.mutation(api.learn.startAttempt, { assessmentId });
    await giorgi.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: files("") });
    await giorgi.mutation(api.learn.submit, { assessmentId });

    const rows = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    // Ana passes 2 of 3 checks (no animation): 4 × 2/3.
    expect(rows.find((r) => r.student.startsWith("ana"))).toMatchObject({ status: "submitted", score: 2.67, maxScore: 4 });
    expect(rows.find((r) => r.student.startsWith("giorgi"))).toMatchObject({ score: 0 });
  });

  test("notes and feedback wait for the results, like the score", async () => {
    const { nino, ana, assessmentId, questionId } = await midterm({ resultsVisibility: "hidden" });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: files(".btn { background: #c6f432; }") });
    await ana.mutation(api.learn.submit, { assessmentId });
    const [row] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    await nino.mutation(api.submissions.addComment, { attemptId: row.attemptId, questionId, file: "style.css", line: 1, text: "Add :hover" });
    await nino.mutation(api.submissions.setGrade, { attemptId: row.attemptId, feedback: "Nice colour." });

    const hidden = await ana.query(api.learn.quiz, { assessmentId });
    expect(hidden.comments).toEqual([]);
    expect(hidden.attempt?.feedback).toBeUndefined();

    await nino.mutation(api.assessments.update, { assessmentId, settings: { resultsVisibility: "score" } });
    const shown = await ana.query(api.learn.quiz, { assessmentId });
    expect(shown.comments).toMatchObject([{ text: "Add :hover" }]);
    expect(shown.attempt?.feedback).toBe("Nice colour.");
  });

  test("full results list every check of a code answer, hidden ones marked", async () => {
    const { nino, ana, assessmentId, questionId } = await midterm({ resultsVisibility: "full_after_close" });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    await ana.mutation(api.learn.saveCodeWork, { assessmentId, questionId, files: files(".btn { background: #c6f432; }") });
    await ana.mutation(api.learn.submit, { assessmentId });
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() - 60_000 } });
    const view = await ana.query(api.learn.quiz, { assessmentId });
    expect(view.review[0].checks).toEqual([
      { id: "s1c1", label: "The button is lime", passed: true, hidden: false },
      { id: "s2c1", label: "Hovered, it is black", passed: false, hidden: false },
      { id: "h1", label: "It pulses", passed: false, hidden: true },
    ]);
  });
});

describe("an exam that isn't open yet, or was taken down", () => {
  test("before its opening time the start screen counts down instead of failing", async () => {
    const opensAt = Date.now() + 3_600_000;
    const { nino, ana, assessmentId } = await midterm({ opensAt });
    const early = await ana.query(api.learn.quiz, { assessmentId });
    expect(early.assessment).toMatchObject({ state: "upcoming", opensAt });
    expect(early.questions).toEqual([]);
    expect(await ana.query(api.learn.quizAnswers, { assessmentId })).toEqual({ answers: [] });
    await expectAppError(ana.mutation(api.learn.startAttempt, { assessmentId }), "CONFLICT");

    // The opening time passes (moved here instead of waiting): asked again, it is open.
    await nino.mutation(api.assessments.update, { assessmentId, settings: { opensAt: Date.now() - 1000 } });
    const open = await ana.query(api.learn.quiz, { assessmentId, refresh: 1 });
    expect(open.assessment.state).toBe("open");
    await ana.mutation(api.learn.startAttempt, { assessmentId });
  });

  test("taken back to draft or archived, it answers NOT_FOUND (the page shows \"not available\")", async () => {
    const { nino, ana, assessmentId } = await midterm();
    await ana.query(api.learn.quiz, { assessmentId });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "archived" });
    await expectAppError(ana.query(api.learn.quiz, { assessmentId }), "NOT_FOUND");
    await expectAppError(ana.query(api.learn.quizAnswers, { assessmentId }), "NOT_FOUND");
  });
});

describe("fixing a code question after students started", () => {
  test("checks and points can change, files and variants can't; regrading applies the fix", async () => {
    const { nino, ana, assessmentId, questionId } = await midterm({ resultsVisibility: "score" });
    await ana.mutation(api.learn.startAttempt, { assessmentId });
    // Ana writes "lime" instead of #c6f432: the check was meant to accept both.
    await ana.mutation(api.learn.saveCodeWork, {
      assessmentId,
      questionId,
      files: files(".btn { background: lime; }\n.btn:hover { background: black; }"),
    });
    await ana.mutation(api.learn.submit, { assessmentId });
    const [before] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(before.score).toBe(1.33);

    const fixed: CodeQuestionInput = {
      ...BUTTON,
      steps: [
        {
          ...BUTTON.steps[0],
          checks: [
            { label: "The button is lime", type: "css", selector: ".btn", property: "background-color", oneOf: ["#c6f432", "lime"] },
          ],
        },
        BUTTON.steps[1],
      ],
    };
    await nino.mutation(api.questions.update, { questionId, question: fixed });
    await expectAppError(
      nino.mutation(api.questions.update, {
        questionId,
        question: { ...fixed, starterFiles: [...fixed.starterFiles, { name: "extra.css", content: "" }] },
      }),
      "CONFLICT",
    );

    const result = await nino.mutation(api.submissions.regrade, { assessmentId, cursor: null });
    expect(result.done).toBe(true);
    expect(result.results).toMatchObject([{ before: 1.33, after: 2.67 }]);
    const [after] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(after).toMatchObject({ status: "submitted", score: 2.67 });

    // Points for one part replace its automatic points; regrading keeps them.
    await nino.mutation(api.submissions.setQuestionPoints, { attemptId: after.attemptId, questionId, points: 4 });
    await nino.mutation(api.submissions.regrade, { assessmentId, cursor: null });
    const [kept] = (await nino.query(api.submissions.forAssessment, { assessmentId, paginationOpts: FIRST_PAGE })).page;
    expect(kept.score).toBe(4);
  });
});

describe("settings", () => {
  test("a time limit and dates can be removed again", async () => {
    const { nino, courseId } = await seed();
    const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "midterm", title: "Midterm" });
    const before = await nino.query(api.assessments.get, { assessmentId });
    expect(before.assessment.settings.timeLimitMin).toBe(60);
    await nino.mutation(api.assessments.update, { assessmentId, settings: { closesAt: Date.now() + 3_600_000 } });
    await nino.mutation(api.assessments.update, { assessmentId, clear: ["timeLimitMin", "closesAt"] });
    const after = await nino.query(api.assessments.get, { assessmentId });
    expect(after.assessment.settings.timeLimitMin).toBeUndefined();
    expect(after.assessment.settings.closesAt).toBeUndefined();
  });
});
