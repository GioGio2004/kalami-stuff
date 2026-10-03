import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/access";
import { appError } from "../lib/errors";
import { optionalText, requireText } from "../lib/input";
import {
  answerKeyValidator,
  codeTaskValidator,
  optionValidator,
  questionTypeValidator,
  viaValidator,
  type AnswerKey,
  type CodeTask,
  type QuestionInput,
} from "../lib/validators";
import {
  MAX_QUESTIONS_PER_ASSESSMENT,
  assessmentValidator,
  isEditableBy,
  recountAssessment,
  requireAssessmentAccess,
  requireEditable,
  toAssessment,
} from "./assessments";
import { logAudit } from "./audit";
import { normalizeCodeTask } from "./codeTasks";

export const MAX_QUESTIONS_PER_CALL = 50;

/** A question as staff see it: with its answer key. Students never get this shape. */
export const questionWithKeyValidator = v.object({
  _id: v.id("questions"),
  order: v.number(),
  type: questionTypeValidator,
  prompt: v.string(),
  points: v.number(),
  options: v.optional(v.array(optionValidator)),
  explanation: v.optional(v.string()),
  code: v.optional(codeTaskValidator),
  key: answerKeyValidator,
  createdVia: viaValidator,
});

export const assessmentDetailValidator = v.object({
  assessment: assessmentValidator,
  questions: v.array(questionWithKeyValidator),
  canEdit: v.boolean(),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
});

type NormalizedQuestion = {
  type: Doc<"questions">["type"];
  prompt: string;
  points: number;
  options?: { id: string; text: string }[];
  explanation?: string;
  code?: CodeTask;
  key: AnswerKey;
};

function optionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requirePoints(points: number | undefined): number {
  if (points === undefined) {
    return 1;
  }
  if (!Number.isFinite(points) || points < 0 || points > 100) {
    throw appError("INVALID_INPUT", "Points must be between 0 and 100.");
  }
  return Math.round(points * 100) / 100;
}

/** Checks a question and splits it into what students see and what they don't. */
export function normalizeQuestion(input: QuestionInput): NormalizedQuestion {
  const prompt = requireText(input.prompt, "Question", 4000);
  const points = requirePoints(input.points);
  const explanation = optionalText(input.explanation, "Explanation", 2000);

  switch (input.type) {
    case "single":
    case "multiple": {
      if (input.options.length < 2 || input.options.length > 10) {
        throw appError("INVALID_INPUT", "A choice question needs 2 to 10 options.");
      }
      const options = input.options.map((option) => ({
        id: optionId(),
        text: requireText(option.text, "Option", 500),
      }));
      const correctIds = options.flatMap((option, i) =>
        input.options[i].correct ? [option.id] : [],
      );
      if (input.type === "single") {
        if (correctIds.length !== 1) {
          throw appError(
            "INVALID_INPUT",
            "A single-choice question needs exactly one correct option.",
          );
        }
        return {
          type: "single",
          prompt,
          points,
          options,
          explanation,
          key: { type: "single", correctOptionId: correctIds[0] },
        };
      }
      if (correctIds.length === 0) {
        throw appError(
          "INVALID_INPUT",
          "A multiple-choice question needs at least one correct option.",
        );
      }
      return {
        type: "multiple",
        prompt,
        points,
        options,
        explanation,
        key: { type: "multiple", correctOptionIds: correctIds },
      };
    }
    case "short": {
      const acceptedAnswers = input.acceptedAnswers
        .map((answer) => answer.trim())
        .filter((answer) => answer !== "");
      if (acceptedAnswers.length === 0 || acceptedAnswers.length > 20) {
        throw appError("INVALID_INPUT", "A short-answer question needs 1 to 20 accepted answers.");
      }
      for (const answer of acceptedAnswers) {
        requireText(answer, "Accepted answer", 200);
      }
      return {
        type: "short",
        prompt,
        points,
        explanation,
        key: { type: "short", acceptedAnswers, caseSensitive: input.caseSensitive ?? false },
      };
    }
    case "essay":
      return {
        type: "essay",
        prompt,
        points,
        explanation,
        key: { type: "essay", rubric: optionalText(input.rubric, "Rubric", 4000) },
      };
    case "code": {
      const task = normalizeCodeTask(input);
      return {
        type: "code",
        prompt,
        points,
        explanation,
        code: task.code,
        key: { type: "code", hiddenChecks: task.hiddenChecks, solution: task.solution },
      };
    }
  }
}

export async function listQuestionsWithKeys(ctx: QueryCtx, assessmentId: Id<"assessments">) {
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  const keys = await ctx.db
    .query("answerKeys")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  const keyByQuestion = new Map(keys.map((key) => [key.questionId, key.key]));
  return questions.flatMap((question) => {
    const key = keyByQuestion.get(question._id);
    // A question without a key would be unmarkable; it can't happen through the API.
    if (key === undefined) {
      return [];
    }
    return [
      {
        _id: question._id,
        order: question.order,
        type: question.type,
        prompt: question.prompt,
        points: question.points,
        options: question.options,
        explanation: question.explanation,
        code: question.code,
        key,
        createdVia: question.createdVia,
      },
    ];
  });
}

export async function getAssessmentDetail(
  ctx: QueryCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
) {
  const { assessment, access } = await requireAssessmentAccess(ctx, actor, assessmentId, "view");
  return {
    assessment: toAssessment(assessment),
    questions: await listQuestionsWithKeys(ctx, assessmentId),
    canEdit:
      access.canEdit && access.course.status !== "archived" && isEditableBy(actor, assessment),
    course: { _id: access.course._id, title: access.course.title },
  };
}

async function nextOrder(ctx: QueryCtx, assessmentId: Id<"assessments">): Promise<number> {
  const last = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .order("desc")
    .first();
  return last === null ? 0 : last.order + 1;
}

export async function addQuestions(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  inputs: QuestionInput[],
): Promise<Id<"questions">[]> {
  const { assessment } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  requireEditable(actor, assessment);
  if (inputs.length === 0 || inputs.length > MAX_QUESTIONS_PER_CALL) {
    throw appError(
      "INVALID_INPUT",
      `Add between 1 and ${MAX_QUESTIONS_PER_CALL} questions per call.`,
    );
  }
  if (assessment.questionCount + inputs.length > MAX_QUESTIONS_PER_ASSESSMENT) {
    throw appError(
      "INVALID_INPUT",
      `An assessment can have at most ${MAX_QUESTIONS_PER_ASSESSMENT} questions.`,
    );
  }
  // Validate everything first so a bad question in the middle adds nothing.
  const normalized = inputs.map(normalizeQuestion);
  let order = await nextOrder(ctx, assessmentId);
  const ids: Id<"questions">[] = [];
  for (const { key, ...fields } of normalized) {
    const questionId = await ctx.db.insert("questions", {
      assessmentId,
      courseId: assessment.courseId,
      order: order++,
      createdVia: actor.via,
      ...fields,
    });
    await ctx.db.insert("answerKeys", { questionId, assessmentId, key });
    ids.push(questionId);
  }
  await recountAssessment(ctx, assessmentId);
  await logAudit(ctx, actor, {
    action: "question.add",
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: assessment.courseId,
    summary: `Added ${ids.length} question${ids.length === 1 ? "" : "s"} to "${assessment.title}"`,
  });
  return ids;
}

async function requireQuestionEditor(ctx: QueryCtx, actor: Actor, questionId: Id<"questions">) {
  const question = await ctx.db.get("questions", questionId);
  if (question === null) {
    throw appError("NOT_FOUND", "Question not found.");
  }
  const { assessment } = await requireAssessmentAccess(ctx, actor, question.assessmentId, "edit");
  requireEditable(actor, assessment);
  return { question, assessment };
}

/** Replaces the whole question. Option ids are regenerated, so saved answers won't match. */
export async function updateQuestion(
  ctx: MutationCtx,
  actor: Actor,
  questionId: Id<"questions">,
  input: QuestionInput,
): Promise<void> {
  const { question, assessment } = await requireQuestionEditor(ctx, actor, questionId);
  const { key, ...fields } = normalizeQuestion(input);
  await ctx.db.patch("questions", questionId, {
    ...fields,
    // Patching with undefined removes a field, e.g. options on a former choice question.
    options: fields.options,
    explanation: fields.explanation,
    code: fields.code,
  });
  const existingKey = await ctx.db
    .query("answerKeys")
    .withIndex("by_questionId", (q) => q.eq("questionId", questionId))
    .unique();
  if (existingKey === null) {
    await ctx.db.insert("answerKeys", { questionId, assessmentId: question.assessmentId, key });
  } else {
    await ctx.db.patch("answerKeys", existingKey._id, { key });
  }
  await recountAssessment(ctx, question.assessmentId);
  await logAudit(ctx, actor, {
    action: "question.update",
    targetTable: "questions",
    targetId: questionId,
    courseId: assessment.courseId,
    summary: `Edited question ${question.order + 1} of "${assessment.title}"`,
  });
}

export async function deleteQuestion(
  ctx: MutationCtx,
  actor: Actor,
  questionId: Id<"questions">,
): Promise<void> {
  const { question, assessment } = await requireQuestionEditor(ctx, actor, questionId);
  const key = await ctx.db
    .query("answerKeys")
    .withIndex("by_questionId", (q) => q.eq("questionId", questionId))
    .unique();
  if (key !== null) {
    await ctx.db.delete("answerKeys", key._id);
  }
  await ctx.db.delete("questions", questionId);
  // Close the gap so orders stay 0..n-1.
  const remaining = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", question.assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  for (const [index, row] of remaining.entries()) {
    if (row.order !== index) {
      await ctx.db.patch("questions", row._id, { order: index });
    }
  }
  await recountAssessment(ctx, question.assessmentId);
  await logAudit(ctx, actor, {
    action: "question.delete",
    targetTable: "questions",
    targetId: questionId,
    courseId: assessment.courseId,
    summary: `Removed question ${question.order + 1} from "${assessment.title}"`,
  });
}

/** `questionIds` must be every question of the assessment, in the new order. */
export async function reorderQuestions(
  ctx: MutationCtx,
  actor: Actor,
  assessmentId: Id<"assessments">,
  questionIds: Id<"questions">[],
): Promise<void> {
  const { assessment } = await requireAssessmentAccess(ctx, actor, assessmentId, "edit");
  requireEditable(actor, assessment);
  const existing = await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .take(MAX_QUESTIONS_PER_ASSESSMENT + 1);
  const existingIds = new Set(existing.map((q) => q._id));
  const uniqueIds = new Set(questionIds);
  if (
    uniqueIds.size !== questionIds.length ||
    uniqueIds.size !== existingIds.size ||
    questionIds.some((id) => !existingIds.has(id))
  ) {
    throw appError("INVALID_INPUT", "Pass every question of this assessment exactly once.");
  }
  for (const [index, questionId] of questionIds.entries()) {
    await ctx.db.patch("questions", questionId, { order: index });
  }
  await ctx.db.patch("assessments", assessmentId, { updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "question.reorder",
    targetTable: "assessments",
    targetId: assessmentId,
    courseId: assessment.courseId,
    summary: `Reordered the questions of "${assessment.title}"`,
  });
}
