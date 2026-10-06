import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireTokenStudent, studentFromToken } from "./lib/access";
import { getStudentLesson, studentLessonValidator } from "./model/lessons";
import { getStudentPresentation, studentPresentationValidator } from "./model/presentations";
import { listMyCourses, listUpNext, getStudentCourse, myCourseValidator, studentCourseValidator, upNextValidator } from "./model/learn";
import {
  getFinishedWork,
  getProgress,
  progressValidator,
  searchCourses,
  studyHitValidator,
  studyWhoami,
  whoamiValidator,
  workValidator,
} from "./model/study";

// The student app's MCP connector (kalami/lib/mcp/server.ts): a student's own
// AI assistant reading their courses, lessons, presentations, materials and finished work.
// Queries only: nothing here changes anything. Every call carries the signed
// service credential of the student who signed in (lib/access.ts).

const tokenArgs = { token: v.string(), client: v.optional(v.string()) };

/** The signed-in student, or null when the credential isn't a student's (the connector answers 401). */
export const whoami = query({
  args: tokenArgs,
  returns: v.union(v.null(), whoamiValidator),
  handler: async (ctx, args) => {
    const student = await studentFromToken(ctx, args.token);
    return student === null ? null : await studyWhoami(ctx, student);
  },
});

export const listCourses = query({
  args: tokenArgs,
  returns: v.array(myCourseValidator),
  handler: async (ctx, args) => await listMyCourses(ctx, await requireTokenStudent(ctx, args.token)),
});

export const getCourse = query({
  args: { ...tokenArgs, courseId: v.id("courses") },
  returns: studentCourseValidator,
  handler: async (ctx, args) => await getStudentCourse(ctx, await requireTokenStudent(ctx, args.token), args.courseId),
});

export const getLesson = query({
  args: { ...tokenArgs, lessonId: v.id("lessons") },
  returns: studentLessonValidator,
  handler: async (ctx, args) => await getStudentLesson(ctx, await requireTokenStudent(ctx, args.token), args.lessonId),
});

/** A published presentation: its theme and every slide's words. */
export const getPresentation = query({
  args: { ...tokenArgs, presentationId: v.id("presentations") },
  returns: studentPresentationValidator,
  handler: async (ctx, args) =>
    await getStudentPresentation(ctx, await requireTokenStudent(ctx, args.token), args.presentationId),
});

/** A finished task, quiz or exam with the student's own answers, as far as the results setting allows. */
export const getWork = query({
  args: { ...tokenArgs, assessmentId: v.id("assessments") },
  returns: workValidator,
  handler: async (ctx, args) => await getFinishedWork(ctx, await requireTokenStudent(ctx, args.token), args.assessmentId),
});

export const progress = query({
  args: tokenArgs,
  returns: progressValidator,
  handler: async (ctx, args) => await getProgress(ctx, await requireTokenStudent(ctx, args.token)),
});

export const upNext = query({
  args: tokenArgs,
  returns: v.array(upNextValidator),
  handler: async (ctx, args) => await listUpNext(ctx, await requireTokenStudent(ctx, args.token)),
});

/** Where a word or phrase appears in the student's published lessons and presentations. */
export const findInCourses = query({
  args: { ...tokenArgs, query: v.string() },
  returns: v.array(studyHitValidator),
  handler: async (ctx, args) => await searchCourses(ctx, await requireTokenStudent(ctx, args.token), args.query),
});
