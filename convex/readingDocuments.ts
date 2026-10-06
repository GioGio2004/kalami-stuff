import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { courseAccess, requireCourseContentEditor, requireTokenActor, type Actor } from "./lib/access";
import { getMemberships, isStaffRole } from "./lib/auth";
import { appError } from "./lib/errors";
import { requireText } from "./lib/input";
import { enforceLimit } from "./lib/limits";
import { DriveError, googleAccessToken } from "./lib/google";
import { createReading, findReading, requirePrivateReadingFolder, writeReading, ReadingHttpError } from "./lib/readingDocument";
import { logAudit } from "./model/audit";
import { driveOf, requireReadingIdle } from "./model/weeks";

const authArgs = { token: v.string(), client: v.optional(v.string()) };
const input = { ...authArgs, weekId: v.id("weeks"), documentKey: v.string(), title: v.string(), content: v.string() };

export const listForAgent = query({
  args: { ...authArgs, weekId: v.id("weeks") },
  returns: v.array(v.object({ documentKey: v.string(), url: v.optional(v.string()), linked: v.boolean() })),
  handler: async (ctx, args) => {
    const actor = await requireTokenActor(ctx, args.token, args.client);
    const week = await ctx.db.get("weeks", args.weekId);
    if (!week) throw appError("NOT_FOUND", "Week not found.");
    await courseAccess(ctx, actor, week.courseId);
    const rows = await ctx.db.query("readingDocuments").withIndex("by_weekId_and_key", (q) => q.eq("weekId", week._id)).take(100);
    return rows.map((row) => ({ documentKey: row.key, url: row.documentId ? `https://docs.google.com/document/d/${encodeURIComponent(row.documentId)}/edit` : undefined, linked: week.links.some((link) => link.id === row._id) }));
  },
});

async function access(ctx: MutationCtx, token: string, client: string | undefined, weekId: Id<"weeks">) {
  const actor = await requireTokenActor(ctx, token, client);
  return await accessForActor(ctx, actor, weekId);
}

async function accessForActor(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">) {
  const week = await ctx.db.get("weeks", weekId);
  if (!week) throw appError("NOT_FOUND", "Week not found.");
  await requireCourseContentEditor(ctx, actor, week.courseId);
  const drive = await driveOf(ctx, week.courseId);
  if (!drive || !week.folderId || !drive.folderId) throw appError("CONFLICT", "Call prepare_week_drive first, then check get_course_outline until its folder is ready.");
  if (drive.ownerId !== actor.user._id) throw appError("FORBIDDEN", "Only this course's Google Drive owner can save reading documents.");
  if (week.status !== "draft" || week.permissionId || week.syncing) throw appError("CONFLICT", "Readings can only be saved in a private draft week after Drive has finished syncing.");
  return { actor, week, folderId: week.folderId, rootId: drive.folderId };
}

export const begin = internalMutation({
  args: { ...input, runId: v.string() },
  returns: v.object({ id: v.id("readingDocuments"), folderId: v.string(), rootId: v.string(), clerkUserId: v.string(), documentId: v.optional(v.string()), createAttempted: v.boolean() }),
  handler: async (ctx, args) => {
    requireText(args.title, "Title", 200);
    requireText(args.content, "Content", 100_000);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(args.documentKey)) throw appError("INVALID_INPUT", "documentKey must be 1–80 letters, digits, hyphens or underscores.");
    const { actor, week, folderId, rootId } = await access(ctx, args.token, args.client, args.weekId);
    if (!actor.user.clerkUserId) throw appError("UNAUTHENTICATED", "Reconnect Kalami in your assistant.");
    requireReadingIdle(week);
    await enforceLimit(ctx, "agent", actor.user._id);
    let row = await ctx.db.query("readingDocuments").withIndex("by_weekId_and_key", (q) => q.eq("weekId", week._id).eq("key", args.documentKey)).unique();
    if (row && (row.ownerId !== actor.user._id || row.folderId !== folderId)) throw appError("CONFLICT", "The course's Drive has changed. Use a new documentKey for a new reading in this Drive.");
    if (week.links.length >= 20 && !week.links.some((link) => link.id === row?._id)) throw appError("INVALID_INPUT", "This week already has 20 links. Remove one before adding a reading.");
    if (!row) {
      const existing = await ctx.db.query("readingDocuments").withIndex("by_weekId_and_key", (q) => q.eq("weekId", week._id)).take(100);
      if (existing.length >= 100) throw appError("CONFLICT", "This week has reached its managed reading limit.");
      const id = await ctx.db.insert("readingDocuments", { courseId: week.courseId, weekId: week._id, key: args.documentKey, ownerId: actor.user._id, folderId, createAttempted: false, updatedAt: Date.now() });
      row = (await ctx.db.get("readingDocuments", id))!;
    }
    // Convex actions have a maximum ten-minute runtime. Never let a new action
    // overtake one that could still be making external writes.
    await ctx.db.patch("weeks", week._id, { readingWrite: { id: args.runId, until: Date.now() + 11 * 60_000 } });
    return { id: row._id, folderId, rootId, clerkUserId: actor.user.clerkUserId, documentId: row.documentId, createAttempted: row.createAttempted };
  },
});

const stepArgs = { id: v.id("readingDocuments"), runId: v.string() };
async function claimed(ctx: MutationCtx, id: Id<"readingDocuments">, runId: string) {
  const row = await ctx.db.get("readingDocuments", id);
  const week = row && await ctx.db.get("weeks", row.weekId);
  if (!row || !week || week.readingWrite?.id !== runId || week.readingWrite.until <= Date.now()) throw appError("CONFLICT", "Reading save expired. Retry with the same documentKey.");
  return { row, week };
}

export const record = internalMutation({
  args: { ...stepArgs, documentId: v.optional(v.string()), rejected: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    await claimed(ctx, args.id, args.runId);
    await ctx.db.patch("readingDocuments", args.id, { createAttempted: !args.rejected, ...(args.documentId ? { documentId: args.documentId } : {}), updatedAt: Date.now() });
    return null;
  },
});

export const finish = internalMutation({
  args: { ...stepArgs, client: v.optional(v.string()), title: v.string(), documentId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { row, week } = await claimed(ctx, args.id, args.runId);
    // Recheck the live account and course permissions without reusing the
    // one-minute transport credential after a potentially slow Google call.
    const user = await ctx.db.get("users", row.ownerId);
    if (!user || user.deletedAt !== undefined) throw appError("UNAUTHENTICATED", "The Drive owner no longer has an active account.");
    const memberships = await getMemberships(ctx, user._id);
    if (!memberships.some((m) => isStaffRole(m.role))) throw appError("FORBIDDEN", "The Drive owner is no longer staff.");
    const { actor } = await accessForActor(ctx, { user, memberships, via: "mcp", client: args.client }, week._id);
    const link = { id: row._id, title: args.title, url: `https://docs.google.com/document/d/${encodeURIComponent(args.documentId)}/edit` };
    const links = week.links.filter((item) => item.id !== row._id);
    if (links.length >= 20) throw appError("CONFLICT", "The week has no room for another link.");
    // Preserve the link's position when replacing its content.
    const index = week.links.findIndex((item) => item.id === row._id);
    links.splice(index < 0 ? links.length : index, 0, link);
    await ctx.db.patch("weeks", week._id, { links, readingWrite: undefined, updatedAt: Date.now() });
    await logAudit(ctx, actor, { action: "reading.save", targetTable: "weeks", targetId: week._id, courseId: week.courseId, summary: `Saved reading "${args.title}" in Google Drive` });
    return null;
  },
});

export const release = internalMutation({
  args: { weekId: v.id("weeks"), runId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const week = await ctx.db.get("weeks", args.weekId);
    if (week?.readingWrite?.id === args.runId) await ctx.db.patch("weeks", week._id, { readingWrite: undefined });
    return null;
  },
});

export const saveAsAgent = action({
  args: input,
  returns: v.object({ documentId: v.string(), url: v.string(), weekId: v.id("weeks"), documentKey: v.string() }),
  handler: async (ctx, args): Promise<{ documentId: string; url: string; weekId: Id<"weeks">; documentKey: string }> => {
    args = { ...args, title: requireText(args.title, "Title", 200), content: requireText(args.content, "Content", 100_000) };
    const runId = crypto.randomUUID();
    const row = await ctx.runMutation(internal.readingDocuments.begin, { ...args, runId });
    try {
      const token = await googleAccessToken(row.clerkUserId);
      await requirePrivateReadingFolder(token, row.folderId, row.rootId);
      let documentId = row.documentId;
      if (!documentId) {
        documentId = await findReading(token, row.id);
        if (!documentId) {
          if (row.createAttempted) throw new DriveError("The earlier creation has an unknown outcome. Retry this documentKey later to recover it; Kalami will not risk creating a duplicate. If it never appears, ask support to inspect the reading record.");
          await ctx.runMutation(internal.readingDocuments.record, { id: row.id, runId });
          try {
            documentId = await createReading(token, row.id, args.title);
          } catch (error) {
            if (error instanceof ReadingHttpError && error.status >= 400 && error.status < 500 && error.status !== 408) {
              await ctx.runMutation(internal.readingDocuments.record, { id: row.id, runId, rejected: true });
            }
            throw error;
          }
        }
        await ctx.runMutation(internal.readingDocuments.record, { id: row.id, runId, documentId });
      }
      await writeReading(token, documentId, row.id, args.title, args.content, row.folderId);
      await ctx.runMutation(internal.readingDocuments.finish, { client: args.client, id: row.id, runId, title: args.title, documentId });
      return { documentId, url: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`, weekId: args.weekId, documentKey: args.documentKey };
    } catch (error) {
      if (error instanceof DriveError) throw appError("CONFLICT", error.message);
      throw error;
    } finally {
      await ctx.runMutation(internal.readingDocuments.release, { weekId: args.weekId, runId });
    }
  },
});

