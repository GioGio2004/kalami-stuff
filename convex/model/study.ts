import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  assessmentKindValidator,
  codeFileValidator,
  localizedTextValidator,
  optionValidator,
  questionTypeValidator,
  resultsVisibilityValidator,
} from "../lib/validators";
import {
  answerKeyOf,
  attemptsOf,
  commentValidator,
  finalScore,
  getStudentCourse,
  getStudentTask,
  hasUngradedEssays,
  listComments,
  listMyCourses,
  questionsOf,
  requireOpenableAssessment,
  responseFor,
  studentTaskValidator,
  visibleResults,
  type Student,
} from "./learn";
import { attemptOrder, studentQuestion } from "./quiz";
import { publishedWeeks } from "./weeks";
import { sceneText } from "../lib/scene";

/**
 * The student's read-only connector (study.ts): what a student's own AI
 * assistant may see. Everything goes through the same model functions as the
 * student app, so a course, lesson or result that the screen wouldn't show is
 * not shown here either. On top of that, finished work only: a quiz or task is
 * analysed once the student can't take it again, so an assistant can never
 * help during an attempt.
 */

const MAX_SEARCH_LESSONS = 300;
const MAX_SEARCH_HITS = 20;

export const whoamiValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  email: v.string(),
  locale: v.union(v.literal("ka"), v.literal("en")),
  university: v.optional(localizedTextValidator),
  courses: v.number(),
});

export async function studyWhoami(ctx: QueryCtx, student: Student) {
  const university = student.universityId === undefined ? null : await ctx.db.get("universities", student.universityId);
  return {
    userId: student.user._id,
    name: [student.user.firstName, student.user.lastName].filter(Boolean).join(" "),
    email: student.user.email,
    locale: student.user.locale,
    university: university?.name,
    courses: (await listMyCourses(ctx, student)).length,
  };
}

// --- Finished work ---------------------------------------------------------------------------

/**
 * Whether the student is done with a piece of work, so it can be analysed:
 * submitted, and no way to take it again (closed, a code task, or no attempts
 * left). Otherwise why not, in the student's words.
 */
export function finishedWith(
  assessment: Doc<"assessments">,
  state: "upcoming" | "open" | "closed",
  attempts: Doc<"attempts">[],
): { finished: boolean; reason?: string } {
  const latest = attempts[0];
  if (state === "upcoming") return { finished: false, reason: "It hasn't opened yet." };
  if (latest === undefined) return { finished: false, reason: "You haven't started it yet. Do it in Kalami first; I can go through it with you afterwards." };
  if (latest.status === "in_progress") return { finished: false, reason: "You're in the middle of it. Finish and submit it in Kalami first." };
  if (state === "closed" || assessment.kind === "task") return { finished: true };
  const left = assessment.settings.attemptsAllowed - attempts.length;
  if (left <= 0) return { finished: true };
  return {
    finished: false,
    reason: `You submitted it, but you can still take it again until it closes (${left} attempt${left === 1 ? "" : "s"} left), so it can't be reviewed yet.`,
  };
}

const workHeadValidator = v.object({
  _id: v.id("assessments"),
  kind: assessmentKindValidator,
  title: v.string(),
  state: v.union(v.literal("open"), v.literal("closed")),
  closesAt: v.optional(v.number()),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
});

const myAnswerValidator = v.union(
  v.object({ type: v.literal("single"), optionId: v.string() }),
  v.object({ type: v.literal("multiple"), optionIds: v.array(v.string()) }),
  v.object({ type: v.literal("short"), text: v.string() }),
  v.object({ type: v.literal("essay"), text: v.string() }),
  v.object({ type: v.literal("code"), files: v.array(codeFileValidator) }),
);

export const workValidator = v.union(
  v.object({ available: v.literal(false), reason: v.string(), assessment: workHeadValidator }),
  v.object({
    available: v.literal(true),
    kind: v.literal("task"),
    task: studentTaskValidator,
  }),
  v.object({
    available: v.literal(true),
    kind: v.union(v.literal("quiz"), v.literal("midterm"), v.literal("final")),
    assessment: v.object({
      ...workHeadValidator.fields,
      instructions: v.optional(v.string()),
      totalPoints: v.number(),
      questionCount: v.number(),
      resultsVisibility: resultsVisibilityValidator,
    }),
    attempt: v.object({
      number: v.number(),
      attemptsUsed: v.number(),
      startedAt: v.number(),
      submittedAt: v.optional(v.number()),
      autoSubmitted: v.boolean(),
      /** Only when the results setting shows a score. */
      score: v.optional(v.number()),
      maxScore: v.number(),
      feedback: v.optional(v.string()),
      pendingGrading: v.boolean(),
    }),
    /** Correct answers and explanations are included only with full results. */
    questions: v.array(
      v.object({
        _id: v.id("questions"),
        type: questionTypeValidator,
        prompt: v.string(),
        points: v.number(),
        options: v.optional(v.array(optionValidator)),
        myAnswer: v.optional(myAnswerValidator),
        pointsEarned: v.optional(v.number()),
        correctOptionIds: v.optional(v.array(v.string())),
        acceptedAnswers: v.optional(v.array(v.string())),
        explanation: v.optional(v.string()),
      }),
    ),
    /** When the questions aren't shown yet, why. */
    note: v.optional(v.string()),
    comments: v.array(commentValidator),
  }),
);

const VISIBILITY_NOTE = {
  hidden: "The lecturer set this work to show no results, so the questions, your answers and the score stay in Kalami.",
  score: "The lecturer set this work to show the score only. The questions and your answers appear here once it closes.",
  full_after_close: "Full results (what was right, with explanations) appear once this work closes.",
} as const;

export async function getFinishedWork(ctx: QueryCtx, student: Student, assessmentId: Id<"assessments">) {
  const { assessment, course, state } = await requireOpenableAssessment(ctx, student, assessmentId);
  const attempts = await attemptsOf(ctx, student.user._id, assessmentId);
  const head = {
    _id: assessment._id,
    kind: assessment.kind,
    title: assessment.title,
    state: state === "closed" ? ("closed" as const) : ("open" as const),
    closesAt: assessment.settings.closesAt,
    course: { _id: course._id, title: course.title },
  };
  const { finished, reason } = finishedWith(assessment, state, attempts);
  if (!finished) {
    return { available: false as const, reason: reason ?? "Not available yet.", assessment: head };
  }
  if (assessment.kind === "task") {
    return { available: true as const, kind: "task" as const, task: await getStudentTask(ctx, student, assessmentId) };
  }

  const attempt = attempts[0];
  const results = visibleResults(assessment, state);
  const all = await questionsOf(ctx, assessmentId);
  // The questions and the student's answers: once the work is closed, or whenever full results are on.
  const show = state === "closed" || results === "full";
  const questions = [];
  if (show) {
    for (const question of attemptOrder(all, student, assessment, attempt)) {
      const seen = studentQuestion(question, student, assessment);
      const response = await responseFor(ctx, attempt._id, question._id);
      const key = results === "full" ? await answerKeyOf(ctx, question._id) : null;
      questions.push({
        _id: question._id,
        type: question.type,
        prompt: seen.prompt,
        points: question.points,
        options: "options" in seen ? seen.options : undefined,
        myAnswer: response?.value,
        pointsEarned: results === "full" && response !== null ? (response.manualPoints ?? response.autoScore) : undefined,
        correctOptionIds:
          key?.type === "single" ? [key.correctOptionId] : key?.type === "multiple" ? key.correctOptionIds : undefined,
        acceptedAnswers: key?.type === "short" ? key.acceptedAnswers : undefined,
        explanation: results === "full" ? question.explanation : undefined,
      });
    }
  }
  return {
    available: true as const,
    kind: assessment.kind as "quiz" | "midterm" | "final",
    assessment: {
      ...head,
      instructions: assessment.instructions,
      totalPoints: assessment.totalPoints,
      questionCount: assessment.questionCount,
      resultsVisibility: assessment.settings.resultsVisibility,
    },
    attempt: {
      number: attempt.number,
      attemptsUsed: attempts.length,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      autoSubmitted: attempt.autoSubmitted ?? false,
      score: results !== "none" ? finalScore(attempt) : undefined,
      maxScore: attempt.maxScore,
      feedback: attempt.feedback,
      pendingGrading: await hasUngradedEssays(ctx, attempt._id, all),
    },
    questions,
    note: show && results === "full" ? undefined : VISIBILITY_NOTE[assessment.settings.resultsVisibility],
    comments: await listComments(ctx, attempt._id),
  };
}

// --- Progress --------------------------------------------------------------------------------

export const progressValidator = v.array(
  v.object({
    course: v.object({ _id: v.id("courses"), title: v.string(), lecturer: v.string(), archived: v.boolean() }),
    work: v.array(
      v.object({
        _id: v.id("assessments"),
        kind: assessmentKindValidator,
        title: v.string(),
        weekTitle: v.optional(v.string()),
        state: v.union(v.literal("upcoming"), v.literal("open"), v.literal("closed")),
        closesAt: v.optional(v.number()),
        status: v.union(v.literal("not_started"), v.literal("in_progress"), v.literal("submitted")),
        /** Only when the results setting shows it. */
        score: v.optional(v.number()),
        totalPoints: v.number(),
        /** Can be analysed with get_my_work. */
        finished: v.boolean(),
      }),
    ),
  }),
);

/** Every course with every piece of work and where the student stands on it. */
export async function getProgress(ctx: QueryCtx, student: Student) {
  const out = [];
  for (const summary of await listMyCourses(ctx, student)) {
    const course = await getStudentCourse(ctx, student, summary._id);
    const weekTitles = new Map(course.weeks.map((week) => [week._id, week.title]));
    const work = [];
    for (const item of course.assessments) {
      const row = await ctx.db.get("assessments", item._id);
      const attempts = row === null ? [] : await attemptsOf(ctx, student.user._id, item._id);
      work.push({
        _id: item._id,
        kind: item.kind,
        title: item.title,
        weekTitle: item.weekId === undefined ? undefined : weekTitles.get(item.weekId),
        state: item.state,
        closesAt: item.closesAt,
        status:
          item.result === null ? ("not_started" as const) : item.result.status === "submitted" ? ("submitted" as const) : ("in_progress" as const),
        score: item.result?.score,
        totalPoints: item.totalPoints,
        finished: row !== null && finishedWith(row, item.state, attempts).finished,
      });
    }
    out.push({
      course: { _id: summary._id, title: summary.title, lecturer: summary.lecturer, archived: summary.archived },
      work,
    });
  }
  return out;
}

// --- Finding things in lessons -------------------------------------------------------------

export const lessonHitValidator = v.object({
  lessonId: v.id("lessons"),
  title: v.string(),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  weekTitle: v.string(),
  /** The first place the text appears, with a little around it. */
  snippet: v.string(),
});

function blockText(block: Doc<"lessons">["blocks"][number]): string {
  switch (block.type) {
    case "text":
      return block.md;
    case "callout":
      return `${block.title ?? ""} ${block.md}`;
    case "code":
      return `${block.caption ?? ""} ${block.code}`;
    case "image":
      return `${block.alt} ${block.caption ?? ""}`;
    case "video":
      return block.caption ?? "";
    case "steps":
      return `${block.title ?? ""} ${block.steps.map((step) => `${step.title ?? ""} ${step.md}`).join(" ")}`;
    case "check":
      return block.check.prompt;
    case "scene":
      return sceneText(block.scene);
  }
}

/** Published lessons of the student's courses whose text contains the words, with a snippet each. */
export async function searchLessons(ctx: QueryCtx, student: Student, rawQuery: string) {
  const needle = rawQuery.trim().toLowerCase().slice(0, 100);
  if (needle.length < 2) return [];
  const hits = [];
  let scanned = 0;
  for (const summary of await listMyCourses(ctx, student)) {
    for (const week of await publishedWeeks(ctx, summary._id)) {
      for (const ref of week.lessons) {
        if (scanned++ >= MAX_SEARCH_LESSONS || hits.length >= MAX_SEARCH_HITS) return hits;
        const lesson = await ctx.db.get("lessons", ref._id);
        if (lesson === null || lesson.status !== "published") continue;
        const haystack = [lesson.title, ...lesson.blocks.map(blockText)].join("\n");
        const at = haystack.toLowerCase().indexOf(needle);
        if (at === -1) continue;
        const start = Math.max(0, at - 80);
        const snippet = `${start > 0 ? "…" : ""}${haystack.slice(start, at + needle.length + 120).replace(/\s+/g, " ").trim()}…`;
        hits.push({
          lessonId: lesson._id,
          title: lesson.title,
          course: { _id: summary._id, title: summary.title },
          weekTitle: week.title,
          snippet,
        });
      }
    }
  }
  return hits;
}
