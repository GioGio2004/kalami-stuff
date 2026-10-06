import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { requireStudent } from "./lib/auth";
import { deckThemeValidator, publishStatusValidator, slideInputValidator } from "./lib/validators";
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  getSharedPresentation,
  getStudentPresentation,
  movePresentation,
  savePresentation,
  setPresentationStatus,
  sharedPresentationValidator,
  sharePresentation,
  staffPresentationValidator,
  stopSharingPresentation,
  studentPresentationValidator,
} from "./model/presentations";

// Presentations (model/presentations.ts): the staff app's editor, the student
// app's player (`read`), and share links (`share`, `stopSharing`, `shared`).

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

/** Up or down within its week, or into another week of the course (appended). */
export const move = mutation({
  args: {
    presentationId: v.id("presentations"),
    direction: v.optional(v.union(v.literal("up"), v.literal("down"))),
    weekId: v.optional(v.id("weeks")),
  },
  returns: v.null(),
  handler: async (ctx, { presentationId, direction, weekId }) => {
    const actor = await requireStaffActor(ctx);
    if (weekId !== undefined) await movePresentation(ctx, actor, presentationId, { weekId });
    else if (direction !== undefined) await movePresentation(ctx, actor, presentationId, { direction });
    return null;
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

// --- Share links ------------------------------------------------------------------------

/** Turns its public link on (or keeps it) with these settings; `newLink` replaces the link. Returns the token. */
export const share = mutation({
  args: { presentationId: v.id("presentations"), notes: v.boolean(), newLink: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, { presentationId, ...options }) => {
    const actor = await requireStaffActor(ctx);
    return await sharePresentation(ctx, actor, presentationId, options);
  },
});

/** Turns its public link off; it stops working at once. */
export const stopSharing = mutation({
  args: { presentationId: v.id("presentations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await stopSharingPresentation(ctx, actor, args.presentationId);
    return null;
  },
});

/** A presentation by its share link, for anyone who has the link: no sign-in. Null for a dead link. */
export const shared = query({
  args: { token: v.string() },
  returns: v.union(v.null(), sharedPresentationValidator),
  handler: async (ctx, args) => {
    return await getSharedPresentation(ctx, args.token);
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
