import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { appError } from "./lib/errors";
import { enforceLimit } from "./lib/limits";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  lessonBlockInputValidator,
  questionInputValidator,
} from "./lib/validators";
import { createAssessment } from "./model/assessments";
import { createCourse } from "./model/courses";
import { discardImportedCourse, exportCourseFile } from "./model/kalami";
import {
  actorFor,
  importAsValidator,
  importResultValidator,
  inspectKalami,
  type ImportResult,
  type InspectResult,
  inspectResultValidator,
  runImport,
} from "./model/kalamiImport";
import { createLesson } from "./model/lessons";
import { addQuestions, MAX_QUESTIONS_PER_CALL } from "./model/questions";
import { createWeek } from "./model/weeks";

// .kalami course files (lib/kalami.ts is the format; KALAMI-FORMAT.md the guide).
// Export is a query; checking and importing are actions, because a whole course
// is created in several steps (model/kalamiImport.ts). The same steps serve
// agents, through mcp.ts.

/** The course as a signed .kalami file: its name and its text. Course editors only (answer keys are inside). */
export const exportCourse = query({
  args: { courseId: v.id("courses") },
  returns: v.object({ fileName: v.string(), content: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await exportCourseFile(ctx, actor, args.courseId);
  },
});

/** What a file contains and whether it's fine, before importing it. Writes nothing. */
export const inspect = action({
  args: { text: v.string() },
  returns: inspectResultValidator,
  handler: async (ctx, args): Promise<InspectResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null || !(await ctx.runQuery(internal.drive.isStaff, { clerkUserId: identity.subject }))) {
      throw appError("FORBIDDEN", "Only lecturers can open course files.");
    }
    return await inspectKalami(args.text);
  },
});

/**
 * Creates the file's course as a new draft owned by the signed-in lecturer.
 * `universityId`: which university it belongs to, `null` for none; left out,
 * the same default as creating a course by hand.
 */
export const importCourse = action({
  args: { text: v.string(), universityId: v.optional(v.union(v.id("universities"), v.null())) },
  returns: importResultValidator,
  handler: async (ctx, args): Promise<ImportResult> => await runImport(ctx, { kind: "session" }, args.text, args.universityId),
});

// --- The import's steps (model/kalamiImport.ts runImport drives them) ----------------------

export const importBegin = internalMutation({
  args: {
    as: importAsValidator,
    title: v.string(),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    language: v.union(v.literal("ka"), v.literal("en")),
    universityId: v.optional(v.id("universities")),
    noUniversity: v.boolean(),
  },
  returns: v.id("courses"),
  handler: async (ctx, args) => {
    const actor = await actorFor(ctx, args.as);
    await enforceLimit(ctx, "createCourse", actor.user._id);
    return await createCourse(ctx, actor, {
      title: args.title,
      description: args.description,
      semester: args.semester,
      locale: args.language,
      universityId: args.noUniversity ? null : args.universityId,
    });
  },
});

export const importWeek = internalMutation({
  args: {
    as: importAsValidator,
    courseId: v.id("courses"),
    title: v.string(),
    description: v.optional(v.string()),
    links: v.array(v.object({ title: v.string(), url: v.string() })),
    lessons: v.array(v.object({ title: v.string(), blocks: v.array(lessonBlockInputValidator) })),
  },
  returns: v.id("weeks"),
  handler: async (ctx, args) => {
    const actor = await actorFor(ctx, args.as);
    const weekId = await createWeek(ctx, actor, {
      courseId: args.courseId,
      title: args.title,
      description: args.description,
      links: args.links,
    });
    for (const lesson of args.lessons) {
      await createLesson(ctx, actor, { weekId, title: lesson.title, blocks: lesson.blocks });
    }
    return weekId;
  },
});

export const importAssessment = internalMutation({
  args: {
    as: importAsValidator,
    courseId: v.id("courses"),
    weekId: v.optional(v.id("weeks")),
    assessment: v.object({
      kind: assessmentKindValidator,
      title: v.string(),
      instructions: v.optional(v.string()),
      settings: v.optional(assessmentSettingsValidator.partial()),
      questions: v.array(questionInputValidator),
    }),
  },
  returns: v.id("assessments"),
  handler: async (ctx, { as, courseId, weekId, assessment }) => {
    const actor = await actorFor(ctx, as);
    const assessmentId = await createAssessment(ctx, actor, {
      courseId,
      kind: assessment.kind,
      title: assessment.title,
      instructions: assessment.instructions,
      settings: assessment.settings,
      weekId,
    });
    for (let i = 0; i < assessment.questions.length; i += MAX_QUESTIONS_PER_CALL) {
      await addQuestions(ctx, actor, assessmentId, assessment.questions.slice(i, i + MAX_QUESTIONS_PER_CALL));
    }
    return assessmentId;
  },
});

export const importDiscard = internalMutation({
  args: { as: importAsValidator, courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await actorFor(ctx, args.as);
    await discardImportedCourse(ctx, actor, args.courseId);
    return null;
  },
});
