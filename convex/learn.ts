import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireStudent } from "./lib/auth";
import { codeFileValidator, integrityCountsValidator } from "./lib/validators";
import {
  autoSubmitClosed,
  getStudentCourse,
  getStudentTask,
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

// Student app (Clerk session): joining courses and working on code tasks.

/** A delta of integrity counters; every field optional. */
const integrityDeltaValidator = integrityCountsValidator.partial();

export const join = mutation({
  args: { code: v.string() },
  returns: joinResultValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
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
    return await saveCode(ctx, student, args);
  },
});

export const reportIntegrityCounts = mutation({
  args: { assessmentId: v.id("assessments"), counts: integrityDeltaValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await reportIntegrity(ctx, student, args.assessmentId, args.counts);
  },
});

export const submit = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await submitTask(ctx, student, args.assessmentId);
  },
});

/** Every minute (crons.ts): submit the work left in progress on tasks that have closed. */
export const autoSubmit = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await autoSubmitClosed(ctx),
});
