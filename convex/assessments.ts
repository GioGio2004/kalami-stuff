import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import {
  assessmentKindValidator,
  assessmentSettingsValidator,
  assessmentStatusValidator,
} from "./lib/validators";
import {
  createAssessment,
  deleteAssessment,
  setAssessmentStatus,
  updateAssessment,
} from "./model/assessments";
import { assessmentDetailValidator, getAssessmentDetail } from "./model/questions";

// Staff app (Clerk session). Quizzes, midterms and finals; questions live in questions.ts.

export const create = mutation({
  args: {
    courseId: v.id("courses"),
    kind: assessmentKindValidator,
    title: v.string(),
    instructions: v.optional(v.string()),
    settings: v.optional(assessmentSettingsValidator.partial()),
  },
  returns: v.id("assessments"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await createAssessment(ctx, actor, args);
  },
});

/** Settings plus every question with its answer key. Staff only, by construction. */
export const get = query({
  args: { assessmentId: v.id("assessments") },
  returns: assessmentDetailValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getAssessmentDetail(ctx, actor, args.assessmentId);
  },
});

export const update = mutation({
  args: {
    assessmentId: v.id("assessments"),
    title: v.optional(v.string()),
    instructions: v.optional(v.string()),
    kind: v.optional(assessmentKindValidator),
    settings: v.optional(assessmentSettingsValidator.partial()),
  },
  returns: v.null(),
  handler: async (ctx, { assessmentId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    await updateAssessment(ctx, actor, assessmentId, patch);
    return null;
  },
});

/** Publishing is deliberately web-only: a person reviews what the agent drafted. */
export const setStatus = mutation({
  args: { assessmentId: v.id("assessments"), status: assessmentStatusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await setAssessmentStatus(ctx, actor, args.assessmentId, args.status);
    return null;
  },
});

export const remove = mutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await deleteAssessment(ctx, actor, args.assessmentId);
    return null;
  },
});
