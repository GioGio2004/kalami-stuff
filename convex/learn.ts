import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireStudent } from "./lib/auth";
import { enforceLimit } from "./lib/limits";
import { answerValueValidator, codeFileValidator, integrityCountsValidator } from "./lib/validators";
import {
  autoSubmitDue,
  finishOpenAttempts as finishOpenAttemptsOf,
  getStudentCourse,
  getStudentTask,
  gradeDue as gradeDueAttempt,
  joinCourse,
  joinResultValidator,
  listMyCourses,
  listUpNext,
  myCourseValidator,
  reportIntegrity,
  saveCode,
  studentCourseValidator,
  studentTaskValidator,
  submitTask,
  upNextValidator,
} from "./model/learn";
import { getQuizAnswers, getStudentQuiz, quizAnswersValidator, saveAnswer, startQuiz, studentQuizValidator } from "./model/quiz";

// Student app (Clerk session): joining courses, code tasks, quizzes and exams.
// Every mutation is rate limited per student (lib/limits.ts).

/** A delta of integrity counters; every field optional. */
const integrityDeltaValidator = integrityCountsValidator.partial();

export const join = mutation({
  args: { code: v.string() },
  returns: joinResultValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "join", student.user._id);
    return await joinCourse(ctx, student, args.code);
  },
});

export const myCourses = query({
  args: {},
  returns: v.array(myCourseValidator),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await listMyCourses(ctx, student);
  },
});

export const upNext = query({
  args: {},
  returns: v.array(upNextValidator),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await listUpNext(ctx, student);
  },
});

export const course = query({
  args: { courseId: v.id("courses") },
  returns: studentCourseValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getStudentCourse(ctx, student, args.courseId);
  },
});

export const task = query({
  args: { assessmentId: v.id("assessments") },
  returns: studentTaskValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getStudentTask(ctx, student, args.assessmentId);
  },
});

export const saveCodeWork = mutation({
  args: {
    assessmentId: v.id("assessments"),
    questionId: v.id("questions"),
    files: v.array(codeFileValidator),
    integrity: v.optional(integrityDeltaValidator),
  },
  returns: v.object({
    savedAt: v.number(),
    progress: v.object({ step: v.number(), passed: v.array(v.string()) }),
  }),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "saveCode", student.user._id);
    return await saveCode(ctx, student, args);
  },
});

/** A quiz, midterm or final: the start screen, the running attempt, or the results. Never the answers (see quizAnswers). */
export const quiz = query({
  args: { assessmentId: v.id("assessments") },
  returns: studentQuizValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getStudentQuiz(ctx, student, args.assessmentId);
  },
});

/** The saved answers of the latest attempt, apart from the quiz so autosaves only refresh this. */
export const quizAnswers = query({
  args: { assessmentId: v.id("assessments") },
  returns: quizAnswersValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getQuizAnswers(ctx, student, args.assessmentId);
  },
});

/** The start screen's button. Returns the attempt in progress if there already is one. */
export const startAttempt = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.id("attempts"),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "startAttempt", student.user._id);
    return await startQuiz(ctx, student, args.assessmentId);
  },
});

export const saveQuizAnswer = mutation({
  args: {
    assessmentId: v.id("assessments"),
    questionId: v.id("questions"),
    answer: answerValueValidator,
    integrity: v.optional(integrityDeltaValidator),
  },
  returns: v.object({ savedAt: v.number() }),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "saveAnswer", student.user._id);
    return await saveAnswer(ctx, student, args);
  },
});

export const reportIntegrityCounts = mutation({
  args: { assessmentId: v.id("assessments"), counts: integrityDeltaValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "integrity", student.user._id);
    return await reportIntegrity(ctx, student, args.assessmentId, args.counts);
  },
});

export const submit = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "submit", student.user._id);
    return await submitTask(ctx, student, args.assessmentId);
  },
});

/** Every minute (crons.ts): hand out the work whose time ran out, or whose assessment closed, for grading. */
export const autoSubmit = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await autoSubmitDue(ctx),
});

/** Scheduled by autoSubmit, one per attempt. */
export const gradeDue = internalMutation({
  args: { attemptId: v.id("attempts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await gradeDueAttempt(ctx, args.attemptId);
    return null;
  },
});

/** Scheduled when published work is taken back: open attempts are graded as they stand. */
export const finishOpenAttempts = internalMutation({
  args: { assessmentId: v.id("assessments"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await finishOpenAttemptsOf(ctx, args.assessmentId, args.cursor);
    return null;
  },
});
