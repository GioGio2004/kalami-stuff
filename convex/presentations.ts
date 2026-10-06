import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { requireStudent } from "./lib/auth";
import { deckThemeValidator, publishStatusValidator, slideInputValidator } from "./lib/validators";
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  getStudentPresentation,
  savePresentation,
  setPresentationStatus,
  staffPresentationValidator,
  studentPresentationValidator,
} from "./model/presentations";

// Presentations (model/presentations.ts): the staff app's editor, and the
// student app's player (`read`).

export const get = query({
  args: { presentationId: v.id("presentations") },
  returns: staffPresentationValidator,
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await getPresentation(ctx, actor, args.presentationId);
  },
});

export const create = mutation({
  args: { weekId: v.id("weeks"), title: v.string(), theme: v.optional(deckThemeValidator) },
  returns: v.id("presentations"),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    return await createPresentation(ctx, actor, args);
  },
});

/** The editor saves the title, theme and every slide at once; returns the ids the slides ended up with. */
export const save = mutation({
  args: {
    presentationId: v.id("presentations"),
    title: v.optional(v.string()),
    theme: v.optional(deckThemeValidator),
    slides: v.optional(v.array(slideInputValidator)),
  },
  returns: v.array(v.string()),
  handler: async (ctx, { presentationId, ...patch }) => {
    const actor = await requireStaffActor(ctx);
    return await savePresentation(ctx, actor, presentationId, patch);
  },
});

export const setStatus = mutation({
  args: { presentationId: v.id("presentations"), status: publishStatusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await setPresentationStatus(ctx, actor, args.presentationId, args.status);
    return null;
  },
});

export const remove = mutation({
  args: { presentationId: v.id("presentations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await deletePresentation(ctx, actor, args.presentationId);
    return null;
  },
});

// --- Students ---------------------------------------------------------------------------

/** A published presentation of one of the student's courses. */
export const read = query({
  args: { presentationId: v.id("presentations") },
  returns: studentPresentationValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await getStudentPresentation(ctx, student, args.presentationId);
  },
});
