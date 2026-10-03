import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fill, seededShuffle } from "../lib/checks";
import { appError } from "../lib/errors";
import { addCounts, hasCounts, NO_COUNTS } from "../lib/integrity";
import {
  assessmentKindValidator,
  attemptStatusValidator,
  codeAssetValidator,
  codeFileValidator,
  codeStepValidator,
  integrityLevelValidator,
  optionValidator,
  questionTypeValidator,
  responseValueValidator,
  resultsVisibilityValidator,
  type AnswerValue,
  type IntegrityCounts,
} from "../lib/validators";
import {
  answerKeyOf,
  attemptsOf,
  commentValidator,
  ensureAttempt,
  finalScore,
  hasUngradedEssays,
  listComments,
  questionsOf,
  requireOpenableAssessment,
  responseFor,
  taskFor,
  visibleResults,
  type Student,
} from "./learn";

/**
 * Quizzes, midterms and finals on the student side (KALAMI.md §4.5): a start
 * screen, then an attempt with a server deadline; answers autosave and the
 * server grades on submit, while essays wait for the lecturer. Questions only
 * reach the student once they press Start, and answer keys only with full
 * results. Code questions inside a quiz save through learn.ts saveCode.
 */

const MAX_SHORT_CHARS = 500;
const MAX_ESSAY_CHARS = 20_000;

const quizQuestionValidator = v.object({
  _id: v.id("questions"),
  type: questionTypeValidator,
  prompt: v.string(),
  points: v.number(),
  // Choices, in this student's order.
  options: v.optional(v.array(optionValidator)),
  // Code questions: the student's own variant.
  code: v.optional(
    v.object({
      files: v.array(codeFileValidator),
      steps: v.array(codeStepValidator),
      assets: v.array(codeAssetValidator),
    }),
  ),
});

export const studentQuizValidator = v.object({
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  assessment: v.object({
    _id: v.id("assessments"),
    kind: assessmentKindValidator,
    title: v.string(),
    instructions: v.optional(v.string()),
    state: v.union(v.literal("open"), v.literal("closed")),
    closesAt: v.optional(v.number()),
    timeLimitMin: v.optional(v.number()),
    integrityLevel: integrityLevelValidator,
    resultsVisibility: resultsVisibilityValidator,
    totalPoints: v.number(),
    questionCount: v.number(),
    attemptsAllowed: v.number(),
  }),
  attemptsUsed: v.number(),
  /** The latest attempt. */
  attempt: v.union(
    v.null(),
    v.object({
      _id: v.id("attempts"),
      number: v.number(),
      status: attemptStatusValidator,
      startedAt: v.number(),
      deadlineAt: v.optional(v.number()),
      submittedAt: v.optional(v.number()),
      autoSubmitted: v.boolean(),
      score: v.optional(v.number()),
      maxScore: v.number(),
      feedback: v.optional(v.string()),
      /** Essays the lecturer hasn't scored yet, so the score may still go up. */
      pendingGrading: v.boolean(),
    }),
  ),
  /** In this student's order; only during an attempt, or with full results. */
  questions: v.array(quizQuestionValidator),
  answers: v.array(v.object({ questionId: v.id("questions"), value: responseValueValidator, savedAt: v.number() })),
  /** With full results: what was right and the points each answer got. */
  review: v.array(
    v.object({
      questionId: v.id("questions"),
      points: v.optional(v.number()),
      correctOptionIds: v.optional(v.array(v.string())),
      acceptedAnswers: v.optional(v.array(v.string())),
      explanation: v.optional(v.string()),
    }),
  ),
  /** The lecturer's red-pen notes on code questions, once submitted. */
  comments: v.array(commentValidator),
});

/** A question as this student sees it: their option order, their code variant. */
function studentQuestion(question: Doc<"questions">, student: Student, assessment: Doc<"assessments">) {
  const base = { _id: question._id, type: question.type, prompt: question.prompt, points: question.points };
  if (question.type === "code" && question.code !== undefined) {
    const { code, values } = taskFor(question.code, student.user, assessment._id);
    return { ...base, prompt: fill(question.prompt, values), code };
  }
  if (question.options !== undefined) {
    const options = assessment.settings.shuffleOptions
      ? seededShuffle(question.options, `${student.user._id}:${question._id}`)
      : question.options;
    return { ...base, options };
  }
  return base;
}

/** The questions in the order this attempt shows them. */
function attemptOrder(questions: Doc<"questions">[], student: Student, assessment: Doc<"assessments">, attempt: Doc<"attempts">) {
  return assessment.settings.shuffleQuestions
    ? seededShuffle(questions, `${student.user._id}:${assessment._id}:${attempt.number}`)
    : questions;
}

export async function getStudentQuiz(
  ctx: QueryCtx,
  student: Student,
  assessmentId: Id<"assessments">,
): Promise<Infer<typeof studentQuizValidator>> {
  const { assessment, course, state } = await requireOpenableAssessment(ctx, student, assessmentId);
  const attempts = await attemptsOf(ctx, student.user._id, assessmentId);
  const attempt = attempts[0] ?? null;
  const submitted = attempt?.status === "submitted";
  const results = submitted ? visibleResults(assessment, state) : "none";
  const all = await questionsOf(ctx, assessmentId);
  const shown = attempt !== null && (attempt.status === "in_progress" || results === "full");

  const questions = [];
  const answers = [];
  const review = [];
  if (shown) {
    for (const question of attemptOrder(all, student, assessment, attempt)) {
      questions.push(studentQuestion(question, student, assessment));
      const response = await responseFor(ctx, attempt._id, question._id);
      if (response !== null) {
        answers.push({ questionId: question._id, value: response.value, savedAt: response.savedAt });
      }
      if (results === "full") {
        const key = await answerKeyOf(ctx, question._id);
        review.push({
          questionId: question._id,
          points: response === null ? 0 : (response.manualPoints ?? response.autoScore),
          correctOptionIds:
            key?.type === "single" ? [key.correctOptionId] : key?.type === "multiple" ? key.correctOptionIds : undefined,
          acceptedAnswers: key?.type === "short" ? key.acceptedAnswers : undefined,
          explanation: question.explanation,
        });
      }
    }
  }

  return {
    course: { _id: course._id, title: course.title },
    assessment: {
      _id: assessment._id,
      kind: assessment.kind,
      title: assessment.title,
      instructions: assessment.instructions,
      state: state === "closed" ? ("closed" as const) : ("open" as const),
      closesAt: assessment.settings.closesAt,
      timeLimitMin: assessment.settings.timeLimitMin,
      integrityLevel: assessment.settings.integrityLevel,
      resultsVisibility: assessment.settings.resultsVisibility,
      totalPoints: assessment.totalPoints,
      questionCount: assessment.questionCount,
      attemptsAllowed: assessment.settings.attemptsAllowed,
    },
    attemptsUsed: attempts.length,
    attempt:
      attempt === null
        ? null
        : {
            _id: attempt._id,
            number: attempt.number,
            status: attempt.status,
            startedAt: attempt.startedAt,
            deadlineAt: attempt.deadlineAt,
            submittedAt: attempt.submittedAt,
            autoSubmitted: attempt.autoSubmitted ?? false,
            score: results !== "none" ? finalScore(attempt) : undefined,
            maxScore: attempt.maxScore,
            feedback: submitted ? attempt.feedback : undefined,
            pendingGrading: submitted && (await hasUngradedEssays(ctx, attempt._id, all)),
          },
    questions,
    answers,
    review,
    comments: submitted && attempt !== null ? await listComments(ctx, attempt._id) : [],
  };
}

/**
 * Starts an attempt from the start screen, or returns the one in progress.
 * The deadline is fixed now: start + time limit, but never past closesAt.
 */
export async function startQuiz(ctx: MutationCtx, student: Student, assessmentId: Id<"assessments">) {
  const { assessment, state } = await requireOpenableAssessment(ctx, student, assessmentId);
  if (assessment.kind === "task") {
    throw appError("CONFLICT", "Code tasks start when you open them.");
  }
  const attempts = await attemptsOf(ctx, student.user._id, assessmentId);
  const latest = attempts[0];
  if (latest?.status === "in_progress") {
    return latest._id;
  }
  if (state === "closed") {
    throw appError("CONFLICT", "This is closed.");
  }
  if (attempts.length >= assessment.settings.attemptsAllowed) {
    throw appError("CONFLICT", "You've used all your attempts.");
  }
  if (assessment.questionCount === 0) {
    throw appError("CONFLICT", "There are no questions yet. Ask your lecturer.");
  }
  const now = Date.now();
  const { timeLimitMin, closesAt } = assessment.settings;
  const limitEnd = timeLimitMin === undefined ? undefined : now + timeLimitMin * 60_000;
  const deadlineAt =
    limitEnd !== undefined && closesAt !== undefined ? Math.min(limitEnd, closesAt) : (limitEnd ?? closesAt);
  return await ctx.db.insert("attempts", {
    assessmentId: assessment._id,
    courseId: assessment.courseId,
    userId: student.user._id,
    number: attempts.length + 1,
    status: "in_progress",
    startedAt: now,
    deadlineAt,
    maxScore: assessment.totalPoints,
    integrity: NO_COUNTS,
  });
}

function checkAnswer(question: Doc<"questions">, answer: AnswerValue): AnswerValue {
  if (answer.type !== question.type) {
    throw appError("INVALID_INPUT", "That answer doesn't fit this question.");
  }
  const optionIds = new Set(question.options?.map((o) => o.id) ?? []);
  switch (answer.type) {
    case "single":
      if (!optionIds.has(answer.optionId)) throw appError("INVALID_INPUT", "Pick one of the options.");
      return answer;
    case "multiple": {
      const chosen = [...new Set(answer.optionIds)];
      if (chosen.some((id) => !optionIds.has(id))) throw appError("INVALID_INPUT", "Pick from the options.");
      return { type: "multiple", optionIds: chosen };
    }
    case "short":
      if (answer.text.length > MAX_SHORT_CHARS) {
        throw appError("INVALID_INPUT", `Keep the answer under ${MAX_SHORT_CHARS} characters.`);
      }
      return answer;
    case "essay":
      if (answer.text.length > MAX_ESSAY_CHARS) {
        throw appError("INVALID_INPUT", `Keep the answer under ${MAX_ESSAY_CHARS} characters.`);
      }
      return answer;
  }
}

/** Autosave of one answer while the attempt runs. */
export async function saveAnswer(
  ctx: MutationCtx,
  student: Student,
  args: {
    assessmentId: Id<"assessments">;
    questionId: Id<"questions">;
    answer: AnswerValue;
    integrity?: Partial<IntegrityCounts>;
  },
) {
  const { assessment, attempt } = await ensureAttempt(ctx, student, args.assessmentId);
  const question = await ctx.db.get("questions", args.questionId);
  if (question === null || question.assessmentId !== assessment._id) {
    throw appError("NOT_FOUND", "Question not found.");
  }
  const value = checkAnswer(question, args.answer);
  if (hasCounts(args.integrity)) {
    await ctx.db.patch("attempts", attempt._id, { integrity: addCounts(attempt.integrity, args.integrity!) });
  }
  const now = Date.now();
  const existing = await responseFor(ctx, attempt._id, question._id);
  if (existing === null) {
    await ctx.db.insert("responses", {
      attemptId: attempt._id,
      questionId: question._id,
      userId: student.user._id,
      value,
      savedAt: now,
    });
  } else {
    await ctx.db.patch("responses", existing._id, { value, savedAt: now });
  }
  return { savedAt: now };
}
