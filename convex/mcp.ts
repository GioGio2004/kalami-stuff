import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { actorFromToken, requireTokenActor, type Actor } from "./lib/access";
import { isSuperAdmin } from "./lib/auth";
import { enforceLimit } from "./lib/limits";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  courseStatusValidator,
  localeValidator,
  localizedTextValidator,
  questionInputValidator,
  roleValidator,
  codeQuestionInputValidator,
  viaValidator,
} from "./lib/validators";
import { assessmentValidator, createAssessment, updateAssessment } from "./model/assessments";
import { displayName } from "./model/audit";
import { codeTaskReportValidator, testCodeTask } from "./model/codeTasks";
import {
  courseCountsValidator,
  courseRoleValidator,
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
 * staff app's /api/mcp route on behalf of an AI agent. Instead of a Clerk
 * session it gets `token`, the staff app's signed credential for the lecturer
 * who signed in with Kalami in their assistant (see lib/access.ts
 * actorFromToken), and `client`, which OAuth client the agent came through,
 * for the audit log; every check after that is the same as in the web app.
 *
 * Deliberately missing: publishing, deleting and anything about students.
 * Agents draft; people review and publish in the dashboard. Join codes are
 * left out too: an agent has no use for them, and they would end up in chat
 * transcripts.
 */

const tokenArg = { token: v.string(), client: v.optional(v.string()) };

/** Creating tools accept a request id, so a retried call returns what the first one made. */
const requestArg = { requestId: v.optional(v.string()) };
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

async function remembered(ctx: QueryCtx, actor: Actor, requestId: string | undefined) {
  if (requestId === undefined) return null;
  const row = await ctx.db
    .query("agentRequests")
    .withIndex("by_actorId_and_requestId", (q) => q.eq("actorId", actor.user._id).eq("requestId", requestId))
    .unique();
  return row !== null && row.at >= Date.now() - REQUEST_WINDOW_MS ? row.result : null;
}

async function remember(ctx: MutationCtx, actor: Actor, requestId: string | undefined, result: string | string[]) {
  if (requestId === undefined || requestId.length > 100) return;
  await ctx.db.insert("agentRequests", { actorId: actor.user._id, requestId, result, at: Date.now() });
}

/** A course as an agent sees it: everything but the join code. */
const agentCourseValidator = v.object({
  _id: v.id("courses"),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  semester: v.optional(v.string()),
  locale: localeValidator,
  status: courseStatusValidator,
  universityId: v.optional(v.id("universities")),
  universityName: v.optional(localizedTextValidator),
  role: courseRoleValidator,
  canEdit: v.boolean(),
  counts: courseCountsValidator,
  /** Students who joined. Only they see the course's published work. */
  students: v.number(),
  createdVia: viaValidator,
  updatedAt: v.number(),
});

function toAgentCourse<T extends { joinCode: string; joinEnabled: boolean }>(course: T): Omit<T, "joinCode" | "joinEnabled"> {
  const { joinCode: _joinCode, joinEnabled: _joinEnabled, ...rest } = course;
  void _joinCode;
  void _joinEnabled;
  return rest;
}

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
    const actor = await actorFromToken(ctx, args.token, args.client);
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
  returns: v.array(agentCourseValidator),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return (await listCoursesFor(ctx, actor)).map(toAgentCourse);
  },
});

export const getCourse = query({
  args: { ...tokenArg, courseId: v.id("courses") },
  returns: v.object({ ...agentCourseValidator.fields, assessments: v.array(assessmentValidator) }),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return toAgentCourse(await getCourseDetail(ctx, actor, args.courseId));
  },
});

export const createCourseAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    title: v.string(),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: v.optional(localeValidator),
    universityId: v.optional(v.id("universities")),
  },
  returns: v.id("courses"),
  handler: async (ctx, { token, client, requestId, ...args }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (typeof earlier === "string") {
      return earlier as Id<"courses">;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    await enforceLimit(ctx, "createCourse", actor.user._id);
    const courseId = await createCourse(ctx, actor, args);
    await remember(ctx, actor, requestId, courseId);
    return courseId;
  },
});

export const getAssessment = query({
  args: { ...tokenArg, assessmentId: v.id("assessments") },
  returns: assessmentDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return await getAssessmentDetail(ctx, actor, args.assessmentId);
  },
});

export const createAssessmentAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    courseId: v.id("courses"),
    kind: assessmentKindValidator,
    title: v.string(),
    instructions: v.optional(v.string()),
    settings: v.optional(assessmentSettingsValidator.partial()),
  },
  returns: v.id("assessments"),
  handler: async (ctx, { token, client, requestId, ...args }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (typeof earlier === "string") {
      return earlier as Id<"assessments">;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    await enforceLimit(ctx, "createAssessment", actor.user._id);
    const assessmentId = await createAssessment(ctx, actor, args);
    await remember(ctx, actor, requestId, assessmentId);
    return assessmentId;
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
  handler: async (ctx, { token, client, assessmentId, ...patch }) => {
    const actor = await requireTokenActor(ctx, token, client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateAssessment(ctx, actor, assessmentId, patch);
    return null;
  },
});

export const addQuestionsAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    assessmentId: v.id("assessments"),
    questions: v.array(questionInputValidator),
  },
  returns: v.array(v.id("questions")),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    const earlier = await remembered(ctx, actor, args.requestId);
    if (Array.isArray(earlier)) {
      return earlier as Id<"questions">[];
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    await enforceLimit(ctx, "addQuestions", actor.user._id);
    const ids = await addQuestions(ctx, actor, args.assessmentId, args.questions);
    await remember(ctx, actor, args.requestId, ids);
    return ids;
  },
});

export const updateQuestionAsAgent = mutation({
  args: { ...tokenArg, questionId: v.id("questions"), question: questionInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateQuestion(ctx, actor, args.questionId, args.question);
    return null;
  },
});

export const deleteQuestionAsAgent = mutation({
  args: { ...tokenArg, questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
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
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
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
    await requireTokenActor(ctx, args.token, args.client);
    return testCodeTask(args.question);
  },
});
