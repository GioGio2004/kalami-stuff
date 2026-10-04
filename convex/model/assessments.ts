import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  courseAccess,
  requireCourseContentEditor,
  type Actor,
  type CourseAccess,
} from "../lib/access";
import { appError } from "../lib/errors";
import { optionalText, requireText } from "../lib/input";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  assessmentStatusValidator,
  viaValidator,
  type AssessmentKind,
  type AssessmentSettings,
  type AssessmentStatus,
} from "../lib/validators";
import { logAudit } from "./audit";
import { notifyOnce } from "./notifications";

export const MAX_QUESTIONS_PER_ASSESSMENT = 200;

export const assessmentValidator = v.object({
  _id: v.id("assessments"),
  _creationTime: v.number(),
  courseId: v.id("courses"),
  // The week a task or quiz sits in; absent for unplaced work and for exams.
  weekId: v.optional(v.id("weeks")),
  kind: assessmentKindValidator,
  title: v.string(),
  instructions: v.optional(v.string()),
  status: assessmentStatusValidator,
  settings: assessmentSettingsValidator,
  questionCount: v.number(),
  totalPoints: v.number(),
  createdVia: viaValidator,
  publishedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export function toAssessment(doc: Doc<"assessments">) {
  return {
    _id: doc._id,
    _creationTime: doc._creationTime,
    courseId: doc.courseId,
    weekId: doc.weekId,
    kind: doc.kind,
    title: doc.title,
    instructions: doc.instructions,
    status: doc.status,
    settings: doc.settings,
    questionCount: doc.questionCount,
    totalPoints: doc.totalPoints,
    createdVia: doc.createdVia,
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
  };
}

/** What a new quiz or exam starts with; the lecturer can change all of it. */
export function defaultSettings(kind: AssessmentKind): AssessmentSettings {
  switch (kind) {
    case "task":
      // Homework in the code sandbox: no timer, one submission, the score straight after.
      return {
        attemptsAllowed: 1,
        shuffleQuestions: false,
        shuffleOptions: false,
        integrityLevel: "standard",
        resultsVisibility: "score",
      };
    case "quiz":
      return {
        attemptsAllowed: 1,
        shuffleQuestions: true,
        shuffleOptions: true,
        integrityLevel: "standard",
        resultsVisibility: "full_after_close",
      };
    case "midterm":
      return {
        timeLimitMin: 60,
        attemptsAllowed: 1,
        shuffleQuestions: true,
        shuffleOptions: true,
        integrityLevel: "strict",
        resultsVisibility: "score",
      };
    case "final":
      return {
        timeLimitMin: 90,
        attemptsAllowed: 1,
        shuffleQuestions: true,
        shuffleOptions: true,
        integrityLevel: "strict",
        resultsVisibility: "score",
      };
  }
}

export function validateSettings(settings: AssessmentSettings): AssessmentSettings {
  const { attemptsAllowed, timeLimitMin, opensAt, closesAt } = settings;
  if (!Number.isInteger(attemptsAllowed) || attemptsAllowed < 1 || attemptsAllowed > 10) {
    throw appError("INVALID_INPUT", "Attempts allowed must be a whole number from 1 to 10.");
  }
  if (
    timeLimitMin !== undefined &&
    (!Number.isInteger(timeLimitMin) || timeLimitMin < 1 || timeLimitMin > 600)
  ) {
    throw appError("INVALID_INPUT", "Time limit must be a whole number of minutes from 1 to 600.");
  }
  for (const [label, value] of [
    ["Opens at", opensAt],
    ["Closes at", closesAt],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw appError("INVALID_INPUT", `${label} must be a timestamp in milliseconds.`);
    }
  }
  if (opensAt !== undefined && closesAt !== undefined && closesAt <= opensAt) {
    throw appError("INVALID_INPUT", "The closing time must be after the opening time.");
  }
  return settings;
}

const KIND_ORDER: Record<AssessmentKind, number> = { task: 0, quiz: 1, midterm: 2, final: 3 };

/** A course's assessments: tasks and quizzes first, then the midterm, then the final. */
export async function listAssessmentsIn(ctx: QueryCtx, courseId: Id<"courses">) {
  const rows = await ctx.db
    .query("assessments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(500);
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a._creationTime - b._creationTime);
  return rows.map(toAssessment);
}

export async function requireAssessmentAccess(
  ctx: QueryCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  level: "view" | "edit",
): Promise<{ assessment: Doc<"assessments">; access: CourseAccess }> {
  const assessment = await ctx.db.get("assessments", assessmentId);
  if (assessment === null) {
    throw appError("NOT_FOUND", "Assessment not found.");
  }
  // Editing also needs the course to be live: archived courses are read-only.
  const access =
    level === "edit"
      ? await requireCourseContentEditor(ctx, actor, assessment.courseId)
      : await courseAccess(ctx, actor, assessment.courseId);
  return { assessment, access };
}

/**
 * Archived assessments are read-only. Agents may only touch drafts: once an
 * assessment is published, students may be taking it, so only a person in the
 * dashboard can change it (or move it back to draft first).
 */
export function requireEditable(actor: Actor, assessment: Doc<"assessments">): void {
  if (assessment.status === "archived") {
    throw appError("CONFLICT", "This assessment is archived. Restore it to a draft to edit it.");
  }
  if (actor.via === "mcp" && assessment.status !== "draft") {
    throw appError(
      "FORBIDDEN",
      "This assessment is published. Agents can only edit drafts — ask the lecturer to move it back to draft in the Kalami dashboard first.",
    );
  }
}

/** The non-throwing form of requireEditable, for `canEdit` flags. */
export function isEditableBy(actor: Actor, assessment: Doc<"assessments">): boolean {
  if (assessment.status === "archived") {
    return false;
  }
  return actor.via !== "mcp" || assessment.status === "draft";
}

/** How many students started this; counted up to a cap no single assessment reaches. */
const STARTED_CAP = 1000;

export async function startedCount(ctx: QueryCtx, assessmentId: Id<"assessments">): Promise<number> {
  const rows = await ctx.db
    .query("attempts")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
    .take(STARTED_CAP);
  return rows.length;
}

async function hasAttempts(ctx: QueryCtx, assessmentId: Id<"assessments">): Promise<boolean> {
  const first = await ctx.db
    .query("attempts")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
    .first();
  return first !== null;
}

/**
 * Once a student has started, the questions are frozen: option ids, order and
 * count are what their saved answers and their shuffled view refer to.
 * `change` names what was attempted, for the message.
 */
export async function requireNoAttempts(ctx: QueryCtx, assessment: Doc<"assessments">, change: string): Promise<void> {
  if (await hasAttempts(ctx, assessment._id)) {
    const started = await startedCount(ctx, assessment._id);
    throw appError(
      "CONFLICT",
      `${started} student${started === 1 ? " has" : "s have"} already started “${assessment.title}”, so you can't ${change} any more. Fix typos with Edit (which keeps the answers), or create a new assessment.`,
    );
  }
}

/** Keeps the denormalised counters on the assessment in step with its questions. */
export async function recountAssessment(ctx: MutationCtx, assessmentId: Id<"assessments">) {
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  const totalPoints = questions.reduce((sum, question) => sum + question.points, 0);
  await ctx.db.patch("assessments", assessmentId, {
    questionCount: questions.length,
    totalPoints: Math.round(totalPoints * 100) / 100,
    updatedAt: Date.now(),
  });
}

export type AssessmentPatch = {
  title?: string;
  instructions?: string;
  kind?: AssessmentKind;
  settings?: Partial<AssessmentSettings>;
};

export async function createAssessment(
  ctx: MutationCtx,
  actor: Actor,
  args: {
    courseId: Id<"courses">;
    kind: AssessmentKind;
    title: string;
    instructions?: string;
    settings?: Partial<AssessmentSettings>;
    /** Tasks and quizzes only: the week of the same course to place it in. */
    weekId?: Id<"weeks">;
  },
): Promise<Id<"assessments">> {
  await requireCourseContentEditor(ctx, actor, args.courseId);
  if (args.weekId !== undefined) {
    if (args.kind !== "task" && args.kind !== "quiz") {
      throw appError("INVALID_INPUT", "Midterms and finals stay in the course's Exams section.");
    }
    const week = await ctx.db.get("weeks", args.weekId);
    if (week === null || week.courseId !== args.courseId) {
      throw appError("NOT_FOUND", "Week not found in this course.");
    }
  }
  const title = requireText(args.title, "Title", 160);
  const instructions = optionalText(args.instructions, "Instructions", 8000);
  const settings = validateSettings({
    ...defaultSettings(args.kind),
    ...stripUndefined(args.settings ?? {}),
  });
  const now = Date.now();
  const assessmentId = await ctx.db.insert("assessments", {
    courseId: args.courseId,
    kind: args.kind,
    title,
    instructions,
    status: "draft",
    settings,
    questionCount: 0,
    totalPoints: 0,
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: now,
    weekId: args.weekId,
  });
  await logAudit(ctx, actor, {
    action: "assessment.create",
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: args.courseId,
    summary: `Created ${args.kind} "${title}" as a draft`,
  });
  return assessmentId;
}

export async function updateAssessment(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  patch: AssessmentPatch,
): Promise<void> {
  const { assessment } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  requireEditable(actor, assessment);
  const changes: Partial<Doc<"assessments">> = {};
  if (patch.title !== undefined) {
    changes.title = requireText(patch.title, "Title", 160);
  }
  if (patch.instructions !== undefined) {
    changes.instructions = optionalText(patch.instructions, "Instructions", 8000);
  }
  if (patch.kind !== undefined && patch.kind !== assessment.kind) {
    // The kind decides which player opens it and where notifications point; it's fixed once live.
    if (assessment.status !== "draft" || (await hasAttempts(ctx, assessmentId))) {
      throw appError("CONFLICT", "The kind can't change once it has been published. Move it back to draft first.");
    }
    changes.kind = patch.kind;
    // Midterms and finals live in the Exams section, never in a week.
    if (patch.kind === "midterm" || patch.kind === "final") {
      changes.weekId = undefined;
    }
  }
  if (patch.settings !== undefined) {
    const settings = validateSettings({
      ...assessment.settings,
      ...stripUndefined(patch.settings),
    });
    const reshuffles =
      settings.shuffleQuestions !== assessment.settings.shuffleQuestions ||
      settings.shuffleOptions !== assessment.settings.shuffleOptions;
    if (reshuffles) {
      await requireNoAttempts(ctx, assessment, "change the shuffling");
    }
    changes.settings = settings;
  }
  await ctx.db.patch("assessments", assessmentId, { ...changes, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "assessment.update",
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: assessment.courseId,
    summary: `Updated ${Object.keys(changes).join(", ") || "nothing"} on "${changes.title ?? assessment.title}"`,
  });
}

export async function setAssessmentStatus(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  status: AssessmentStatus,
): Promise<void> {
  const { assessment, access } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  if (assessment.status === status) {
    return;
  }
  if (status === "published" && assessment.questionCount === 0) {
    throw appError("CONFLICT", "Add at least one question before publishing.");
  }
  await ctx.db.patch("assessments", assessmentId, {
    status,
    publishedAt: status === "published" ? Date.now() : assessment.publishedAt,
    updatedAt: Date.now(),
  });
  // Students hear about it the first time it's published to a course they can see.
  if (status === "published" && access.course.status === "published") {
    await notifyOnce(ctx, assessmentId, "published");
  }
  // Taken away from students mid-attempt: their work is submitted as it stands, not stranded.
  if (assessment.status === "published" && (await hasAttempts(ctx, assessmentId))) {
    await ctx.scheduler.runAfter(0, internal.learn.finishOpenAttempts, { assessmentId, cursor: null });
  }
  const verb =
    status === "published" ? "Published" : status === "archived" ? "Archived" : "Moved back to draft";
  await logAudit(ctx, actor, {
    action: `assessment.${status}`,
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: assessment.courseId,
    summary: `${verb} "${assessment.title}"`,
  });
}

/** Only drafts nobody has worked on can be deleted; everything else keeps its history. */
export async function deleteAssessment(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
): Promise<void> {
  const { assessment } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  if (assessment.status !== "draft") {
    throw appError("CONFLICT", "Only drafts can be deleted. Archive it instead.");
  }
  if (await hasAttempts(ctx, assessmentId)) {
    throw appError("CONFLICT", "Students have worked on this, so it can't be deleted. Archive it instead.");
  }
  const keys = await ctx.db
    .query("answerKeys")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  for (const key of keys) {
    await ctx.db.delete("answerKeys", key._id);
  }
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  for (const question of questions) {
    await ctx.db.delete("questions", question._id);
  }
  await ctx.db.delete("assessments", assessmentId);
  await logAudit(ctx, actor, {
    action: "assessment.delete",
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: assessment.courseId,
    summary: `Deleted draft "${assessment.title}"`,
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
