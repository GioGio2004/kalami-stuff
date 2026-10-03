import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { actorFromToken, requireTokenActor, requireTokenActorAndTouch } from "./lib/access";
import { isSuperAdmin } from "./lib/auth";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  localeValidator,
  localizedTextValidator,
  questionInputValidator,
  roleValidator,
  codeQuestionInputValidator,
} from "./lib/validators";
import { createAssessment, updateAssessment } from "./model/assessments";
import { displayName } from "./model/audit";
import { codeTaskReportValidator, testCodeTask } from "./model/codeTasks";
import {
  courseDetailValidator,
  courseSummaryValidator,
  createCourse,
  creatableUniversities,
  getCourseDetail,
  listCoursesFor,
  universityOptionValidator,
} from "./model/courses";
import {
  addQuestions,
  assessmentDetailValidator,
  deleteQuestion,
  getAssessmentDetail,
  reorderQuestions,
  updateQuestion,
} from "./model/questions";

/**
 * The MCP connector's view of the backend. Each function is called by the
 * staff app's /api/mcp route on behalf of an AI agent and authenticates with a
 * personal access token instead of a Clerk session. The token identifies a
 * staff member; every check after that is the same as in the web app.
 *
 * Deliberately missing: publishing, deleting and anything about students.
 * Agents draft; people review and publish in the dashboard.
 */

const tokenArg = { token: v.string() };

const whoamiValidator = v.object({
  userId: v.id("users"),
  email: v.string(),
  name: v.string(),
  isSuperAdmin: v.boolean(),
  roles: v.array(
    v.object({
      role: roleValidator,
      universityId: v.optional(v.id("universities")),
      universityName: v.optional(localizedTextValidator),
    }),
  ),
  // Where this person may create courses.
  universities: v.array(universityOptionValidator),
});

/** Null for an invalid or revoked token, so the route can answer 401 cleanly. */
export const whoami = query({
  args: tokenArg,
  returns: v.union(v.null(), whoamiValidator),
  handler: async (ctx, args) => {
    const actor = await actorFromToken(ctx, args.token);
    if (actor === null) {
      return null;
    }
    const roles = [];
    for (const membership of actor.memberships) {
      const university = membership.universityId
        ? await ctx.db.get("universities", membership.universityId)
        : null;
      roles.push({
        role: membership.role,
        universityId: membership.universityId,
        universityName: university?.name,
      });
    }
    return {
      userId: actor.user._id,
      email: actor.user.email,
      name: displayName(actor.user),
      isSuperAdmin: isSuperAdmin(actor.memberships),
      roles,
      universities: await creatableUniversities(ctx, actor),
    };
  },
});

export const listCourses = query({
  args: tokenArg,
  returns: v.array(courseSummaryValidator),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token);
    return await listCoursesFor(ctx, actor);
  },
});

export const getCourse = query({
  args: { ...tokenArg, courseId: v.id("courses") },
  returns: courseDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token);
    return await getCourseDetail(ctx, actor, args.courseId);
  },
});

export const createCourseAsAgent = mutation({
  args: {
    ...tokenArg,
    title: v.string(),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: v.optional(localeValidator),
    universityId: v.optional(v.id("universities")),
  },
  returns: v.id("courses"),
  handler: async (ctx, { token, ...args }) => {
    const actor = await requireTokenActorAndTouch(ctx, token);
    return await createCourse(ctx, actor, args);
  },
});

export const getAssessment = query({
  args: { ...tokenArg, assessmentId: v.id("assessments") },
  returns: assessmentDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token);
    return await getAssessmentDetail(ctx, actor, args.assessmentId);
  },
});

export const createAssessmentAsAgent = mutation({
  args: {
    ...tokenArg,
    courseId: v.id("courses"),
    kind: assessmentKindValidator,
    title: v.string(),
    instructions: v.optional(v.string()),
    settings: v.optional(assessmentSettingsValidator.partial()),
  },
  returns: v.id("assessments"),
  handler: async (ctx, { token, ...args }) => {
    const actor = await requireTokenActorAndTouch(ctx, token);
    return await createAssessment(ctx, actor, args);
  },
});

export const updateAssessmentAsAgent = mutation({
  args: {
    ...tokenArg,
    assessmentId: v.id("assessments"),
    title: v.optional(v.string()),
    instructions: v.optional(v.string()),
    kind: v.optional(assessmentKindValidator),
    settings: v.optional(assessmentSettingsValidator.partial()),
  },
  returns: v.null(),
  handler: async (ctx, { token, assessmentId, ...patch }) => {
    const actor = await requireTokenActorAndTouch(ctx, token);
    await updateAssessment(ctx, actor, assessmentId, patch);
    return null;
  },
});

export const addQuestionsAsAgent = mutation({
  args: {
    ...tokenArg,
    assessmentId: v.id("assessments"),
    questions: v.array(questionInputValidator),
  },
  returns: v.array(v.id("questions")),
  handler: async (ctx, args) => {
    const actor = await requireTokenActorAndTouch(ctx, args.token);
    return await addQuestions(ctx, actor, args.assessmentId, args.questions);
  },
});

export const updateQuestionAsAgent = mutation({
  args: { ...tokenArg, questionId: v.id("questions"), question: questionInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActorAndTouch(ctx, args.token);
    await updateQuestion(ctx, actor, args.questionId, args.question);
    return null;
  },
});

export const deleteQuestionAsAgent = mutation({
  args: { ...tokenArg, questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActorAndTouch(ctx, args.token);
    await deleteQuestion(ctx, actor, args.questionId);
    return null;
  },
});

export const reorderQuestionsAsAgent = mutation({
  args: {
    ...tokenArg,
    assessmentId: v.id("assessments"),
    questionIds: v.array(v.id("questions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActorAndTouch(ctx, args.token);
    await reorderQuestions(ctx, actor, args.assessmentId, args.questionIds);
    return null;
  },
});

/**
 * Dry run for a code question: runs every check on the starter files and on the
 * solution without saving anything, so an agent can fix its task before
 * add_questions (which refuses tasks whose solution fails a check).
 */
export const checkCodeTask = query({
  args: { ...tokenArg, question: codeQuestionInputValidator },
  returns: codeTaskReportValidator,
  handler: async (ctx, args) => {
    await requireTokenActor(ctx, args.token);
    return testCodeTask(args.question);
  },
});
