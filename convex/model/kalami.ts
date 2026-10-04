import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireCourseEditor, type Actor } from "../lib/access";
import { appError } from "../lib/errors";
import {
  KALAMI_FORMAT,
  KALAMI_SCHEMA_URL,
  KALAMI_VERSION,
  kalamiFileName,
  parseKalami,
  signedPart,
  summarize,
  type KalamiAssessment,
  type KalamiFile,
  type KalamiSummary,
} from "../lib/kalami";
import { sign, verify } from "../lib/tokens";
import type { AnswerKey, CheckRuleDoc, LessonBlock, QuestionInput } from "../lib/validators";
import { defaultSettings, validateSettings } from "./assessments";
import { displayName } from "./audit";
import { normalizeBlocks } from "./lessons";
import { normalizeQuestion } from "./questions";
import { lessonsOf, requireHttpsUrl, weeksOf } from "./weeks";

/**
 * Exporting a course to a .kalami file and checking one before import (the
 * format itself: lib/kalami.ts). Writing an import happens in kalami.ts, in
 * steps an action drives, because a big course is more than one mutation
 * should carry.
 */

// --- Export -------------------------------------------------------------------------------

function stripCheckId({ id: _id, ...rest }: CheckRuleDoc) {
  void _id;
  return rest;
}

/** A stored question and its answer key, back in the shape an author writes. */
function toQuestionInput(question: Doc<"questions">, key: AnswerKey | null): QuestionInput {
  const base = { prompt: question.prompt, points: question.points, explanation: question.explanation };
  switch (question.type) {
    case "single":
      return {
        type: "single",
        ...base,
        options: (question.options ?? []).map((o) => ({
          text: o.text,
          correct: key?.type === "single" && key.correctOptionId === o.id,
        })),
      };
    case "multiple":
      return {
        type: "multiple",
        ...base,
        options: (question.options ?? []).map((o) => ({
          text: o.text,
          correct: key?.type === "multiple" && key.correctOptionIds.includes(o.id),
        })),
      };
    case "short":
      return {
        type: "short",
        ...base,
        acceptedAnswers: key?.type === "short" ? key.acceptedAnswers : [],
        caseSensitive: key?.type === "short" ? key.caseSensitive : undefined,
      };
    case "essay":
      return { type: "essay", ...base, rubric: key?.type === "essay" ? key.rubric : undefined };
    case "code": {
      const code = question.code!;
      return {
        type: "code",
        ...base,
        starterFiles: code.files,
        steps: code.steps.map((step) => ({
          title: step.title,
          instructions: step.instructions,
          hint: step.hint,
          checks: step.checks.map(stripCheckId),
        })),
        hiddenChecks: key?.type === "code" ? key.hiddenChecks.map(stripCheckId) : [],
        solution: key?.type === "code" ? key.solution : [],
        assets: code.assets,
        variables: code.variables,
      };
    }
  }
}

async function assessmentToFile(ctx: QueryCtx, assessment: Doc<"assessments">): Promise<KalamiAssessment> {
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessment._id))
    .take(200);
  const out: QuestionInput[] = [];
  for (const question of questions) {
    const key = await ctx.db
      .query("answerKeys")
      .withIndex("by_questionId", (q) => q.eq("questionId", question._id))
      .unique();
    out.push(toQuestionInput(question, key?.key ?? null));
  }
  const { opensAt: _opensAt, closesAt: _closesAt, ...settings } = assessment.settings;
  void _opensAt;
  void _closesAt;
  return {
    kind: assessment.kind,
    title: assessment.title,
    instructions: assessment.instructions,
    settings,
    questions: out as KalamiAssessment["questions"],
  };
}

function blockToFile({ id: _id, ...rest }: LessonBlock) {
  void _id;
  return rest;
}

/**
 * The course as a .kalami file, signed. Only course editors may export: the
 * file carries every answer key. Archived assessments are left out.
 */
export async function exportCourseFile(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">) {
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const assessments = (
    await ctx.db
      .query("assessments")
      .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
      .take(500)
  )
    .filter((a) => a.status !== "archived")
    .sort((a, b) => a._creationTime - b._creationTime);
  const weeks = await weeksOf(ctx, courseId);
  const weekIds = new Set(weeks.map((w) => w._id));

  const fileWeeks = [];
  for (const week of weeks) {
    const lessons = await lessonsOf(ctx, week._id);
    const placed = [];
    for (const a of assessments) {
      if (a.weekId === week._id && (a.kind === "task" || a.kind === "quiz")) {
        placed.push(await assessmentToFile(ctx, a));
      }
    }
    fileWeeks.push({
      title: week.title,
      description: week.description,
      lessons: lessons.map((lesson) => ({ title: lesson.title, blocks: lesson.blocks.map(blockToFile) })),
      links: week.links.map((link) => ({ title: link.title, url: link.url })),
      driveFolder: week.folderId ? `https://drive.google.com/drive/folders/${week.folderId}` : undefined,
      assessments: placed,
    });
  }
  const exams = [];
  const other = [];
  for (const a of assessments) {
    if (a.kind === "midterm" || a.kind === "final") exams.push(await assessmentToFile(ctx, a));
    else if (a.weekId === undefined || !weekIds.has(a.weekId)) other.push(await assessmentToFile(ctx, a));
  }

  const file = {
    $schema: KALAMI_SCHEMA_URL,
    format: KALAMI_FORMAT,
    version: KALAMI_VERSION,
    kind: "course",
    exported: { by: displayName(actor.user), at: new Date().toISOString(), from: "Kalami" },
    signature: undefined as string | undefined,
    course: {
      title: course.title,
      description: course.description,
      semester: course.semester,
      language: course.locale,
      weeks: fileWeeks,
      exams,
      other,
    },
  };
  // The signature covers exactly what JSON.parse will give back for this text.
  const plain = JSON.parse(JSON.stringify(file)) as KalamiFile;
  file.signature = (await sign(signedPart(plain))) ?? undefined;
  return { fileName: kalamiFileName(course.title), content: JSON.stringify(file, null, 2) };
}

// --- Checking a file ---------------------------------------------------------------------

export type KalamiCheck =
  | {
      ok: true;
      file: KalamiFile;
      summary: KalamiSummary;
      /** Set when the file is exactly as Kalami exported it. */
      verified: { by: string; at: string } | null;
    }
  | { ok: false; errors: string[]; summary?: KalamiSummary };

function messageOf(error: unknown): string {
  const data = (error as { data?: { message?: unknown } }).data;
  if (typeof data?.message === "string") return data.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything short of writing: the format, then each lesson block, link,
 * question and settings object through the same checks the web app uses.
 * So an import that passes this almost never fails half-way.
 */
export async function checkKalami(raw: string): Promise<KalamiCheck> {
  const parsed = parseKalami(raw);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }
  const { file } = parsed;
  const summary = summarize(file);
  const errors: string[] = [];
  const attempt = (where: string, fn: () => void) => {
    if (errors.length >= 20) return;
    try {
      fn();
    } catch (error) {
      errors.push(`${where}: ${messageOf(error)}`);
    }
  };
  const checkAssessment = (where: string, a: KalamiAssessment) => {
    attempt(where, () => validateSettings({ ...defaultSettings(a.kind), ...stripUndefined(a.settings ?? {}) }));
    a.questions.forEach((q, i) => attempt(`${where} › questions[${i}]`, () => normalizeQuestion(q as QuestionInput)));
  };
  file.course.weeks.forEach((week, w) => {
    week.links.forEach((link, i) => attempt(`course › weeks[${w}] › links[${i}]`, () => requireHttpsUrl(link.url)));
    week.lessons.forEach((lesson, l) => attempt(`course › weeks[${w}] › lessons[${l}]`, () => normalizeBlocks(lesson.blocks)));
    week.assessments.forEach((a, i) => checkAssessment(`course › weeks[${w}] › assessments[${i}]`, a));
  });
  file.course.exams.forEach((a, i) => checkAssessment(`course › exams[${i}]`, a));
  file.course.other.forEach((a, i) => checkAssessment(`course › other[${i}]`, a));
  if (errors.length > 0) {
    return { ok: false, errors, summary };
  }

  // The signature is checked on the file exactly as written, before zod normalised it.
  const original = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as KalamiFile;
  const verified =
    original.signature && original.exported && (await verify(signedPart(original), original.signature))
      ? { by: original.exported.by, at: original.exported.at }
      : null;
  return { ok: true, file, summary, verified };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// --- Undoing a failed import ------------------------------------------------------------

/**
 * Removes a course an import created, with everything in it, when a later
 * step failed. Only ever called on a course made moments ago, which no student
 * has joined; refuses anything else.
 */
export async function discardImportedCourse(ctx: MutationCtx, actor: Actor, courseId: Id<"courses">) {
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const enrolled = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .first();
  if (course.status !== "draft" || enrolled !== null || Date.now() - course._creationTime > 15 * 60 * 1000) {
    throw appError("CONFLICT", "Only a course that was just imported can be removed this way.");
  }
  for (const assessment of await ctx.db
    .query("assessments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(500)) {
    for (const key of await ctx.db
      .query("answerKeys")
      .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessment._id))
      .take(500)) {
      await ctx.db.delete("answerKeys", key._id);
    }
    for (const question of await ctx.db
      .query("questions")
      .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessment._id))
      .take(500)) {
      await ctx.db.delete("questions", question._id);
    }
    await ctx.db.delete("assessments", assessment._id);
  }
  for (const week of await weeksOf(ctx, courseId)) {
    for (const lesson of await lessonsOf(ctx, week._id)) {
      await ctx.db.delete("lessons", lesson._id);
    }
    await ctx.db.delete("weeks", week._id);
  }
  for (const seat of await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(50)) {
    await ctx.db.delete("courseStaff", seat._id);
  }
  await ctx.db.delete("courses", courseId);
}
