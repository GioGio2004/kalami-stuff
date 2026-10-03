import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireStaffActor, type Actor } from "./lib/access";
import { appError } from "./lib/errors";
import { requireText } from "./lib/input";
import { integrityColor, integrityScore } from "./lib/integrity";
import { awaitsGrading } from "./lib/grading";
import {
  answerKeyValidator,
  answerValueValidator,
  attemptStatusValidator,
  checkOutcomeValidator,
  checkRuleValidator,
  codeAssetValidator,
  codeFileValidator,
  codeStepValidator,
  integrityColorValidator,
  integrityCountsValidator,
  optionValidator,
} from "./lib/validators";
import { requireAssessmentAccess } from "./model/assessments";
import { displayName, logAudit } from "./model/audit";
import { hiddenChecksFor, listComments, recomputeScore, taskFor } from "./model/learn";

// Staff app (Clerk session): who worked on an assessment, what they wrote, and grading it.
// Anyone who can see the course (owner, assistant, admin) can grade.

const answerTypeValidator = v.union(v.literal("single"), v.literal("multiple"), v.literal("short"), v.literal("essay"));

async function requireAttempt(ctx: QueryCtx, actor: Actor, attemptId: Id<"attempts">) {
  const attempt = await ctx.db.get("attempts", attemptId);
  if (attempt === null) {
    throw appError("NOT_FOUND", "Submission not found.");
  }
  const { assessment } = await requireAssessmentAccess(ctx, actor, attempt.assessmentId, "view");
  return { attempt, assessment };
}

export const forAssessment = query({
  args: { assessmentId: v.id("assessments") },
  returns: v.array(
    v.object({
      attemptId: v.id("attempts"),
      student: v.string(),
      /** 1 for the first attempt; more only when retries are allowed. */
      number: v.number(),
      status: attemptStatusValidator,
      autoSubmitted: v.boolean(),
      startedAt: v.number(),
      submittedAt: v.optional(v.number()),
      score: v.optional(v.number()),
      maxScore: v.number(),
      graded: v.boolean(),
      /** Code questions: steps done across all of them. */
      stepsDone: v.number(),
      stepsTotal: v.number(),
      /** Every other question: how many have an answer. */
      answered: v.number(),
      questionsTotal: v.number(),
      /** An essay with an answer and no points yet. */
      needsGrading: v.boolean(),
      integrity: integrityCountsValidator,
      integrityScore: v.number(),
      integrityColor: integrityColorValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await requireAssessmentAccess(ctx, actor, args.assessmentId, "view");
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", args.assessmentId))
      .take(200);
    const stepsTotal = questions.reduce((sum, q) => sum + (q.code?.steps.length ?? 0), 0);
    const questionsTotal = questions.filter((q) => q.type !== "code").length;
    const attempts = await ctx.db
      .query("attempts")
      .withIndex("by_assessmentId", (q) => q.eq("assessmentId", args.assessmentId))
      .take(500);
    const rows = [];
    for (const attempt of attempts) {
      let stepsDone = 0;
      let answered = 0;
      let needsGrading = false;
      for (const question of questions) {
        const response = await ctx.db
          .query("responses")
          .withIndex("by_attemptId_and_questionId", (q) =>
            q.eq("attemptId", attempt._id).eq("questionId", question._id),
          )
          .unique();
        if (response === null) continue;
        if (response.value.type === "code") {
          stepsDone += response.progress?.step ?? 0;
        } else {
          answered++;
          needsGrading ||= attempt.status === "submitted" && awaitsGrading(response.value, response.manualPoints);
        }
      }
      const score = integrityScore(attempt.integrity);
      rows.push({
        attemptId: attempt._id,
        student: displayName(await ctx.db.get("users", attempt.userId)),
        number: attempt.number,
        status: attempt.status,
        autoSubmitted: attempt.autoSubmitted ?? false,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        score: attempt.manualScore ?? attempt.score,
        maxScore: attempt.maxScore,
        graded: attempt.gradedAt !== undefined,
        stepsDone,
        stepsTotal,
        answered,
        questionsTotal,
        needsGrading,
        integrity: attempt.integrity,
        integrityScore: score,
        integrityColor: integrityColor(score),
      });
    }
    rows.sort((a, b) => a.student.localeCompare(b.student) || a.number - b.number);
    return rows;
  },
});

export const detail = query({
  args: { attemptId: v.id("attempts") },
  returns: v.object({
    student: v.string(),
    number: v.number(),
    status: attemptStatusValidator,
    autoSubmitted: v.boolean(),
    autoScore: v.optional(v.number()),
    manualScore: v.optional(v.number()),
    maxScore: v.number(),
    feedback: v.optional(v.string()),
    integrity: integrityCountsValidator,
    integrityColor: integrityColorValidator,
    questions: v.array(
      v.object({
        questionId: v.id("questions"),
        prompt: v.string(),
        // This student's variant of the task, as they saw it, with the hidden checks filled in too.
        code: v.object({
          files: v.array(codeFileValidator),
          steps: v.array(codeStepValidator),
          assets: v.array(codeAssetValidator),
        }),
        hiddenChecks: v.array(checkRuleValidator),
        files: v.optional(v.array(codeFileValidator)),
        savedAt: v.optional(v.number()),
        checkResults: v.optional(v.array(checkOutcomeValidator)),
        autoScore: v.optional(v.number()),
      }),
    ),
    /** Every question that isn't code, in order, with its key and the student's answer. */
    answers: v.array(
      v.object({
        questionId: v.id("questions"),
        type: answerTypeValidator,
        prompt: v.string(),
        points: v.number(),
        options: v.optional(v.array(optionValidator)),
        key: v.union(v.null(), answerKeyValidator),
        value: v.optional(answerValueValidator),
        savedAt: v.optional(v.number()),
        autoScore: v.optional(v.number()),
        manualPoints: v.optional(v.number()),
      }),
    ),
    comments: v.array(
      v.object({
        _id: v.id("codeComments"),
        questionId: v.id("questions"),
        file: v.string(),
        line: v.number(),
        text: v.string(),
        author: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const { attempt } = await requireAttempt(ctx, actor, args.attemptId);
    const user = await ctx.db.get("users", attempt.userId);
    if (user === null) {
      throw appError("NOT_FOUND", "Student not found.");
    }
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", attempt.assessmentId))
      .take(200);
    const out = [];
    const answers = [];
    for (const question of questions) {
      const key = await ctx.db
        .query("answerKeys")
        .withIndex("by_questionId", (q) => q.eq("questionId", question._id))
        .unique();
      const response = await ctx.db
        .query("responses")
        .withIndex("by_attemptId_and_questionId", (q) => q.eq("attemptId", attempt._id).eq("questionId", question._id))
        .unique();
      if (question.type !== "code") {
        answers.push({
          questionId: question._id,
          type: question.type,
          prompt: question.prompt,
          points: question.points,
          options: question.options,
          key: key?.key ?? null,
          value: response === null || response.value.type === "code" ? undefined : response.value,
          savedAt: response?.savedAt,
          autoScore: response?.autoScore,
          manualPoints: response?.manualPoints,
        });
        continue;
      }
      if (question.code === undefined) continue;
      const { code, values } = taskFor(question.code, user, attempt.assessmentId);
      out.push({
        questionId: question._id,
        prompt: question.prompt,
        code,
        hiddenChecks: hiddenChecksFor(key?.key.type === "code" ? key.key.hiddenChecks : [], values),
        files: response?.value.type === "code" ? response.value.files : undefined,
        savedAt: response?.savedAt,
        checkResults: response?.checkResults,
        autoScore: response?.autoScore,
      });
    }
    return {
      student: displayName(user),
      number: attempt.number,
      status: attempt.status,
      autoSubmitted: attempt.autoSubmitted ?? false,
      autoScore: attempt.score,
      manualScore: attempt.manualScore,
      maxScore: attempt.maxScore,
      feedback: attempt.feedback,
      integrity: attempt.integrity,
      integrityColor: integrityColor(integrityScore(attempt.integrity)),
      questions: out,
      answers,
      comments: await listComments(ctx, attempt._id),
    };
  },
});

/**
 * Points for one answer, mostly essays. They replace the automatic points of
 * that answer and the attempt's score is added up again; undefined goes back to
 * the automatic points.
 */
export const setQuestionPoints = mutation({
  args: {
    attemptId: v.id("attempts"),
    questionId: v.id("questions"),
    points: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const { attempt, assessment } = await requireAttempt(ctx, actor, args.attemptId);
    if (attempt.status !== "submitted") {
      throw appError("CONFLICT", "Grade the work once it is submitted.");
    }
    const question = await ctx.db.get("questions", args.questionId);
    if (question === null || question.assessmentId !== attempt.assessmentId) {
      throw appError("NOT_FOUND", "Question not found.");
    }
    if (args.points !== undefined && (!Number.isFinite(args.points) || args.points < 0 || args.points > question.points)) {
      throw appError("INVALID_INPUT", `Give between 0 and ${question.points} points.`);
    }
    const response = await ctx.db
      .query("responses")
      .withIndex("by_attemptId_and_questionId", (q) => q.eq("attemptId", attempt._id).eq("questionId", question._id))
      .unique();
    if (response === null) {
      throw appError("CONFLICT", "The student didn't answer this question, so it counts as 0.");
    }
    await ctx.db.patch("responses", response._id, {
      manualPoints: args.points === undefined ? undefined : Math.round(args.points * 100) / 100,
    });
    await recomputeScore(ctx, attempt);
    await logAudit(ctx, actor, {
      action: "grading.points",
      targetTable: "attempts",
      targetId: attempt._id,
      courseId: attempt.courseId,
      summary: `Gave points for question ${question.order + 1} in “${assessment.title}”`,
    });
    return null;
  },
});

/** A red-pen note on one line of a student's file. */
export const addComment = mutation({
  args: {
    attemptId: v.id("attempts"),
    questionId: v.id("questions"),
    file: v.string(),
    line: v.number(),
    text: v.string(),
  },
  returns: v.id("codeComments"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const { attempt, assessment } = await requireAttempt(ctx, actor, args.attemptId);
    const question = await ctx.db.get("questions", args.questionId);
    if (question === null || question.assessmentId !== attempt.assessmentId) {
      throw appError("NOT_FOUND", "Question not found.");
    }
    if (!question.code?.files.some((f) => f.name === args.file)) {
      throw appError("INVALID_INPUT", "That file isn't part of the task.");
    }
    if (!Number.isInteger(args.line) || args.line < 1 || args.line > 5000) {
      throw appError("INVALID_INPUT", "Pick a line of the file.");
    }
    const id = await ctx.db.insert("codeComments", {
      attemptId: attempt._id,
      questionId: question._id,
      file: args.file,
      line: args.line,
      text: requireText(args.text, "Comment", 1000),
      authorId: actor.user._id,
      createdAt: Date.now(),
    });
    await logAudit(ctx, actor, {
      action: "grading.comment",
      targetTable: "attempts",
      targetId: attempt._id,
      courseId: attempt.courseId,
      summary: `Commented on line ${args.line} of ${args.file} in “${assessment.title}”`,
    });
    return id;
  },
});

export const removeComment = mutation({
  args: { commentId: v.id("codeComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const comment = await ctx.db.get("codeComments", args.commentId);
    if (comment === null) {
      return null;
    }
    await requireAttempt(ctx, actor, comment.attemptId);
    await ctx.db.delete("codeComments", comment._id);
    return null;
  },
});

/** The overall note and, optionally, a score that replaces the automatic one. */
export const setGrade = mutation({
  args: {
    attemptId: v.id("attempts"),
    feedback: v.optional(v.string()),
    manualScore: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const { attempt, assessment } = await requireAttempt(ctx, actor, args.attemptId);
    if (attempt.status !== "submitted") {
      throw appError("CONFLICT", "Grade the work once it is submitted.");
    }
    if (
      args.manualScore !== undefined &&
      (!Number.isFinite(args.manualScore) || args.manualScore < 0 || args.manualScore > attempt.maxScore)
    ) {
      throw appError("INVALID_INPUT", `The score must be between 0 and ${attempt.maxScore}.`);
    }
    const feedback = args.feedback?.trim();
    if (feedback !== undefined && feedback.length > 4000) {
      throw appError("INVALID_INPUT", "The note must be at most 4000 characters.");
    }
    await ctx.db.patch("attempts", attempt._id, {
      feedback: feedback === "" ? undefined : feedback,
      manualScore: args.manualScore === undefined ? undefined : Math.round(args.manualScore * 100) / 100,
      gradedAt: Date.now(),
      gradedBy: actor.user._id,
    });
    await logAudit(ctx, actor, {
      action: "grading.grade",
      targetTable: "attempts",
      targetId: attempt._id,
      courseId: attempt.courseId,
      summary: `Graded a submission of “${assessment.title}”`,
    });
    return null;
  },
});
