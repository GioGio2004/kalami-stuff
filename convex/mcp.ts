import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { actorFromToken, requireTokenActor } from "./lib/access";
import { isSuperAdmin } from "./lib/auth";
import { appError } from "./lib/errors";
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
  lessonBlockInputValidator,
  viaValidator,
  deckThemeValidator,
  slideInputValidator,
} from "./lib/validators";
import { assessmentValidator, createAssessment, deleteAssessment, updateAssessment } from "./model/assessments";
import { remember, remembered } from "./model/agentRequests";
import { displayName } from "./model/audit";
import {
  addBlocks,
  createLesson,
  deleteBlock,
  deleteLesson,
  getLesson,
  moveLesson,
  reorderLessons,
  setBlocks,
  staffLessonValidator,
  updateBlock,
  updateLesson,
} from "./model/lessons";
import { exportCourseFile } from "./model/kalami";
import {
  importResultValidator,
  inspectKalami,
  inspectResultValidator,
  runImport,
  type ImportResult,
  type InspectResult,
} from "./model/kalamiImport";
import { outlineValidator } from "./model/outline";
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  savePresentation,
  staffPresentationValidator,
} from "./model/presentations";
import { addDriveFolder } from "./model/weeks";
import { codeTaskReportValidator, testCodeTask } from "./model/codeTasks";
import {
  courseCountsValidator,
  courseRoleValidator,
  createCourse,
  creatableUniversities,
  getCourseDetail,
  updateCourse,
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
import {
  addLinks,
  createWeek,
  getOutline,
  placeAssessment,
  removeLink,
  removeWeek,
  reorderLinks,
  reorderWeeks,
  updateLink,
  updateWeek,
} from "./model/weeks";

/**
 * The MCP connector's view of the backend. Each function is called by the
 * staff app's /api/mcp route on behalf of an AI agent. Instead of a Clerk
 * session it gets `token`, the staff app's signed credential for the lecturer
 * who signed in with Kalami in their assistant (see lib/access.ts
 * actorFromToken), and `client`, which OAuth client the agent came through,
 * for the audit log; every check after that is the same as in the web app.
 *
 * Deliberately missing: publishing (assessments, weeks, lessons),
 * deleting courses, and anything about students. Agents draft
 * and may delete only drafts; people review and publish in the dashboard. Join codes are
 * left out too: an agent has no use for them, and they would end up in chat
 * transcripts.
 */

const tokenArg = { token: v.string(), client: v.optional(v.string()) };

/** Creating tools accept a request id, so a retried call returns what the first one made. */
const requestArg = { requestId: v.optional(v.string()) };
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

/** A draft course's title, description, semester or language. Students never saw a draft course. */
export const updateCourseAsAgent = mutation({
  args: {
    ...tokenArg,
    courseId: v.id("courses"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: v.optional(localeValidator),
  },
  returns: v.null(),
  handler: async (ctx, { token, client, courseId, ...patch }) => {
    const actor = await requireTokenActor(ctx, token, client);
    await enforceLimit(ctx, "agent", actor.user._id);
    const course = await ctx.db.get("courses", courseId);
    if (course !== null && course.status !== "draft") {
      throw appError(
        "CONFLICT",
        `"${course.title}" is ${course.status}, so only the lecturer can change its details, in the Kalami dashboard.`,
      );
    }
    await updateCourse(ctx, actor, courseId, patch);
    return null;
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
    weekId: v.optional(v.id("weeks")),
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

/** Drafts nobody has worked on only (deleteAssessment refuses anything else). */
export const deleteAssessmentAsAgent = mutation({
  args: { ...tokenArg, assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await deleteAssessment(ctx, actor, args.assessmentId);
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

// --- Course outline: weeks and lessons ---------------------------------------------
//
// Agents build the outline as drafts: weeks, lessons (blocks), links, and where
// tasks and quizzes sit. Drive folders use the lecturer's existing Google
// consent. Agents can't publish and can only change draft weeks
// and draft lessons; they may add a new draft lesson to a published week.

const linkInputValidator = v.object({ title: v.string(), url: v.string() });

export const getCourseOutline = query({
  args: { ...tokenArg, courseId: v.id("courses") },
  returns: outlineValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return await getOutline(ctx, actor, args.courseId, Date.now());
  },
});

export const createWeekAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    courseId: v.id("courses"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    links: v.optional(v.array(linkInputValidator)),
  },
  returns: v.id("weeks"),
  handler: async (ctx, { token, client, requestId, ...args }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (typeof earlier === "string") {
      return earlier as Id<"weeks">;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    const weekId = await createWeek(ctx, actor, args);
    await remember(ctx, actor, requestId, weekId);
    return weekId;
  },
});

export const updateWeekAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), title: v.optional(v.string()), description: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { token, client, weekId, ...patch }) => {
    const actor = await requireTokenActor(ctx, token, client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateWeek(ctx, actor, weekId, patch);
    return null;
  },
});

export const reorderWeeksAsAgent = mutation({
  args: { ...tokenArg, courseId: v.id("courses"), weekIds: v.array(v.id("weeks")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await reorderWeeks(ctx, actor, args.courseId, args.weekIds);
    return null;
  },
});

export const deleteWeekAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await removeWeek(ctx, actor, args.weekId);
    return null;
  },
});

export const addWeekLinksAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), links: v.array(linkInputValidator) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    return await addLinks(ctx, actor, args.weekId, args.links);
  },
});

export const removeWeekLinkAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), linkId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await removeLink(ctx, actor, args.weekId, args.linkId);
    return null;
  },
});

export const updateWeekLinkAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), linkId: v.string(), link: linkInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateLink(ctx, actor, args.weekId, args.linkId, args.link);
    return null;
  },
});

export const reorderWeekLinksAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), linkIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await reorderLinks(ctx, actor, args.weekId, args.linkIds);
    return null;
  },
});

export const placeAssessmentAsAgent = mutation({
  args: { ...tokenArg, assessmentId: v.id("assessments"), weekId: v.union(v.id("weeks"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await placeAssessment(ctx, actor, args.assessmentId, args.weekId);
    return null;
  },
});

export const getLessonAsAgent = query({
  args: { ...tokenArg, lessonId: v.id("lessons") },
  returns: staffLessonValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return await getLesson(ctx, actor, args.lessonId);
  },
});

export const createLessonAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    weekId: v.id("weeks"),
    title: v.string(),
    blocks: v.optional(v.array(lessonBlockInputValidator)),
  },
  returns: v.id("lessons"),
  handler: async (ctx, { token, client, requestId, ...args }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (typeof earlier === "string") {
      return earlier as Id<"lessons">;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    const lessonId = await createLesson(ctx, actor, args);
    await remember(ctx, actor, requestId, lessonId);
    return lessonId;
  },
});

export const updateLessonAsAgent = mutation({
  args: { ...tokenArg, lessonId: v.id("lessons"), title: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { token, client, lessonId, ...patch }) => {
    const actor = await requireTokenActor(ctx, token, client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateLesson(ctx, actor, lessonId, patch);
    return null;
  },
});

export const setLessonBlocksAsAgent = mutation({
  args: { ...tokenArg, lessonId: v.id("lessons"), blocks: v.array(lessonBlockInputValidator) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    return await setBlocks(ctx, actor, args.lessonId, args.blocks);
  },
});

export const addLessonBlocksAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    lessonId: v.id("lessons"),
    blocks: v.array(lessonBlockInputValidator),
    position: v.optional(v.number()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, { token, client, requestId, lessonId, blocks, position }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (Array.isArray(earlier)) {
      return earlier;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    const ids = await addBlocks(ctx, actor, lessonId, blocks, position);
    await remember(ctx, actor, requestId, ids);
    return ids;
  },
});

export const updateLessonBlockAsAgent = mutation({
  args: { ...tokenArg, lessonId: v.id("lessons"), blockId: v.string(), block: lessonBlockInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await updateBlock(ctx, actor, args.lessonId, args.blockId, args.block);
    return null;
  },
});

export const deleteLessonBlockAsAgent = mutation({
  args: { ...tokenArg, lessonId: v.id("lessons"), blockId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await deleteBlock(ctx, actor, args.lessonId, args.blockId);
    return null;
  },
});

export const moveLessonAsAgent = mutation({
  args: {
    ...tokenArg,
    lessonId: v.id("lessons"),
    weekId: v.optional(v.id("weeks")),
    direction: v.optional(v.union(v.literal("up"), v.literal("down"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await moveLesson(ctx, actor, args.lessonId, args.weekId ? { weekId: args.weekId } : { direction: args.direction ?? "down" });
    return null;
  },
});

export const reorderLessonsAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks"), lessonIds: v.array(v.id("lessons")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await reorderLessons(ctx, actor, args.weekId, args.lessonIds);
    return null;
  },
});

export const deleteLessonAsAgent = mutation({
  args: { ...tokenArg, lessonId: v.id("lessons") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await deleteLesson(ctx, actor, args.lessonId);
    return null;
  },
});

// --- Presentations ----------------------------------------------------------------------
//
// Agents draft whole decks (typed slides in a theme, lib/presentation) and may
// rewrite drafts; publishing stays with the lecturer.

export const getPresentationAsAgent = query({
  args: { ...tokenArg, presentationId: v.id("presentations") },
  returns: staffPresentationValidator,
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return await getPresentation(ctx, actor, args.presentationId);
  },
});

export const createPresentationAsAgent = mutation({
  args: {
    ...tokenArg,
    ...requestArg,
    weekId: v.id("weeks"),
    title: v.string(),
    theme: v.optional(deckThemeValidator),
    slides: v.array(slideInputValidator),
  },
  returns: v.id("presentations"),
  handler: async (ctx, { token, client, requestId, ...args }) => {
    const actor = await requireTokenActor(ctx, token, client);
    const earlier = await remembered(ctx, actor, requestId);
    if (typeof earlier === "string") {
      return earlier as Id<"presentations">;
    }
    await enforceLimit(ctx, "agent", actor.user._id);
    if (args.slides.length === 0) {
      throw appError("INVALID_INPUT", "A presentation needs at least one slide.");
    }
    const presentationId = await createPresentation(ctx, actor, args);
    await remember(ctx, actor, requestId, presentationId);
    return presentationId;
  },
});

export const updatePresentationAsAgent = mutation({
  args: {
    ...tokenArg,
    presentationId: v.id("presentations"),
    title: v.optional(v.string()),
    theme: v.optional(deckThemeValidator),
    slides: v.optional(v.array(slideInputValidator)),
  },
  returns: v.array(v.string()),
  handler: async (ctx, { token, client, presentationId, ...patch }) => {
    const actor = await requireTokenActor(ctx, token, client);
    await enforceLimit(ctx, "agent", actor.user._id);
    return await savePresentation(ctx, actor, presentationId, patch);
  },
});

export const deletePresentationAsAgent = mutation({
  args: { ...tokenArg, presentationId: v.id("presentations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await deletePresentation(ctx, actor, args.presentationId);
    return null;
  },
});

// --- .kalami course files -----------------------------------------------------------
//
// An agent can hand the lecturer a whole course as a file (export), or write
// one (see KALAMI-FORMAT.md) and import it as a new draft course. A dry run
// checks a file and returns every problem without creating anything, so an
// agent can fix its file before importing.

export const exportCourseForAgent = query({
  args: { ...tokenArg, courseId: v.id("courses") },
  returns: v.object({ fileName: v.string(), content: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    return await exportCourseFile(ctx, actor, args.courseId);
  },
});

export const checkKalamiForAgent = action({
  args: { ...tokenArg, text: v.string() },
  returns: inspectResultValidator,
  handler: async (ctx, args): Promise<InspectResult> => {
    const me = await ctx.runQuery(api.mcp.whoami, { token: args.token, client: args.client });
    if (me === null) {
      throw appError("UNAUTHENTICATED", "Not signed in to Kalami as staff. Reconnect Kalami in your assistant.");
    }
    return await inspectKalami(args.text);
  },
});

export const importKalamiForAgent = action({
  args: {
    ...tokenArg,
    ...requestArg,
    text: v.string(),
    universityId: v.optional(v.union(v.id("universities"), v.null())),
  },
  returns: importResultValidator,
  handler: async (ctx, args): Promise<ImportResult> =>
    await runImport(
      ctx,
      { kind: "agent", token: args.token, client: args.client, requestId: args.requestId },
      args.text,
      args.universityId,
    ),
});

/** Uses the same private-folder job as the dashboard, with draft-only MCP access. */
export const prepareWeekDriveAsAgent = mutation({
  args: { ...tokenArg, weekId: v.id("weeks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    await enforceLimit(ctx, "agent", actor.user._id);
    await addDriveFolder(ctx, actor, args.weekId);
    return null;
  },
});
