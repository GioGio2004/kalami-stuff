import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { appError } from "./lib/errors";
import { enforceLimit } from "./lib/limits";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  deckThemeValidator,
  lessonBlockInputValidator,
  questionInputValidator,
  slideInputValidator,
} from "./lib/validators";
import { createAssessment } from "./model/assessments";
import { createCourse } from "./model/courses";
import { remember, remembered } from "./model/agentRequests";
import {
  checkPresentationFile,
  discardImportedCourse,
  exportCourseFile,
  exportPresentationFile,
  importPresentationFile,
  presentationFileImportValidator,
  presentationFileInspectValidator,
  type PresentationFileImport,
  type PresentationFileInspect,
} from "./model/kalami";
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
import { createPresentation } from "./model/presentations";
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

// --- Presentation files ---------------------------------------------------------------------

/** A presentation as a signed .kalami file: its name and its text. */
export const exportPresentation = query({
  args: { presentationId: v.id("presentations") },
  returns: v.object({ fileName: v.string(), content: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await exportPresentationFile(ctx, actor, args.presentationId);
  },
});

/** What a presentation file contains and whether it's fine, before importing it. Writes nothing. */
export const inspectPresentation = query({
  args: { text: v.string() },
  returns: presentationFileInspectValidator,
  handler: async (ctx, args): Promise<PresentationFileInspect> => {
    await requireStaffActor(ctx);
    const check = await checkPresentationFile(args.text);
    return check.ok ? { ok: true as const, summary: check.summary, verified: check.verified } : check;
  },
});

/** Creates the file's presentation as a new draft at the end of the week. */
export const importPresentation = mutation({
  args: { weekId: v.id("weeks"), text: v.string() },
  returns: presentationFileImportValidator,
  handler: async (ctx, args): Promise<PresentationFileImport> => {
    const actor = await requireStaffActor(ctx);
    return await importPresentationFile(ctx, actor, args.weekId, args.text);
  },
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
  returns: v.object({ courseId: v.id("courses"), existing: v.boolean() }),
  handler: async (ctx, args) => {
    const actor = await actorFor(ctx, args.as);
    if (args.as.kind === "agent") {
      const earlier = await remembered(ctx, actor, args.as.requestId);
      if (typeof earlier === "string") {
        const course = await ctx.db.get("courses", earlier as Id<"courses">);
        if (course !== null) return { courseId: course._id, existing: true };
      }
      await enforceLimit(ctx, "agent", actor.user._id);
    }
    await enforceLimit(ctx, "createCourse", actor.user._id);
    const courseId = await createCourse(ctx, actor, {
      title: args.title,
      description: args.description,
      semester: args.semester,
      locale: args.language,
      universityId: args.noUniversity ? null : args.universityId,
    });
    return { courseId, existing: false };
  },
});

/** The import landed whole: an agent retrying the same request gets this course back. */
export const importFinish = internalMutation({
  args: { as: importAsValidator, courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.as.kind === "agent") {
      const actor = await actorFor(ctx, args.as);
      await remember(ctx, actor, args.as.requestId, args.courseId);
    }
    return null;
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
    presentations: v.optional(
      v.array(v.object({ title: v.string(), theme: v.optional(deckThemeValidator), slides: v.array(slideInputValidator) })),
    ),
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
    for (const deck of args.presentations ?? []) {
      await createPresentation(ctx, actor, { weekId, title: deck.title, theme: deck.theme, slides: deck.slides });
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
