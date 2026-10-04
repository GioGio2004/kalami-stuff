import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { enforceLimit } from "./lib/limits";
import { questionInputValidator } from "./lib/validators";
import {
  addQuestions,
  deleteQuestion,
  reorderQuestions,
  updateQuestion,
} from "./model/questions";

// Staff app (Clerk session). Reading questions goes through assessments.get.

export const add = mutation({
  args: { assessmentId: v.id("assessments"), questions: v.array(questionInputValidator) },
  returns: v.array(v.id("questions")),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await enforceLimit(ctx, "addQuestions", actor.user._id);
    return await addQuestions(ctx, actor, args.assessmentId, args.questions);
  },
});

export const update = mutation({
  args: { questionId: v.id("questions"), question: questionInputValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await updateQuestion(ctx, actor, args.questionId, args.question);
    return null;
  },
});

export const remove = mutation({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await deleteQuestion(ctx, actor, args.questionId);
    return null;
  },
});

export const reorder = mutation({
  args: { assessmentId: v.id("assessments"), questionIds: v.array(v.id("questions")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await reorderQuestions(ctx, actor, args.assessmentId, args.questionIds);
    return null;
  },
});
