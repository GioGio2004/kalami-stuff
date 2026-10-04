import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireStudent, requireUser } from "./lib/auth";
import { enforceLimit } from "./lib/limits";
import { contactRecipientValidator, contactTopicValidator } from "./lib/validators";
import {
  alreadyReplied,
  alreadyStarted,
  contactOptions,
  contactOptionsValidator,
  deleteConversation,
  getThread,
  inboxConversationValidator,
  listInbox,
  listStudentConversations,
  markRead as markReadModel,
  reply as replyModel,
  RETENTION_MS,
  setResolved,
  startConversation,
  studentConversationValidator,
  threadValidator,
  unreadCount as unreadCountModel,
} from "./model/messages";

// The contact card and the conversations behind it (model/messages.ts).
// Students start them in the student app; staff answer from the inbox in the
// staff app. `thread`, `reply`, `resolve` and `markRead` serve both sides.

const contextArgs = {
  courseId: v.optional(v.id("courses")),
  weekId: v.optional(v.id("weeks")),
  assessmentId: v.optional(v.id("assessments")),
};

// --- Students ---------------------------------------------------------------------------

/** Who the student can write to, and the context they're writing from, as the server sees it. */
export const contactOptionsFor = query({
  args: contextArgs,
  returns: contactOptionsValidator,
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    return await contactOptions(ctx, student, args);
  },
});

export const start = mutation({
  args: {
    ...contextArgs,
    // The client's id for this send: retrying with the same one returns the same conversation.
    clientOpId: v.string(),
    recipient: contactRecipientValidator,
    lecturerId: v.optional(v.id("users")),
    topic: contactTopicValidator,
    customTopic: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
  },
  returns: v.id("conversations"),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    // A retry of a send that already landed returns it, even when the budget is spent.
    const earlier = await alreadyStarted(ctx, student, args.clientOpId);
    if (earlier !== null) {
      return earlier;
    }
    await enforceLimit(ctx, "startConversation", student.user._id);
    return await startConversation(ctx, student, args);
  },
});

export const mine = query({
  args: {},
  returns: v.array(studentConversationValidator),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await listStudentConversations(ctx, student);
  },
});

// --- Both sides -------------------------------------------------------------------------

export const thread = query({
  args: { conversationId: v.id("conversations") },
  returns: threadValidator,
  handler: async (ctx, args) => await getThread(ctx, args.conversationId),
});

export const reply = mutation({
  args: { conversationId: v.id("conversations"), clientOpId: v.string(), body: v.string() },
  returns: v.id("conversationMessages"),
  handler: async (ctx, { conversationId, ...args }) => {
    const user = await requireUser(ctx);
    const earlier = await alreadyReplied(ctx, conversationId, user._id, args.clientOpId);
    if (earlier !== null) {
      return earlier;
    }
    await enforceLimit(ctx, "sendMessage", user._id);
    return await replyModel(ctx, conversationId, args);
  },
});

export const resolve = mutation({
  args: { conversationId: v.id("conversations"), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await setResolved(ctx, args.conversationId, args.resolved);
    return null;
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markReadModel(ctx, args.conversationId);
    return null;
  },
});

/** For the badge next to Messages (student app) or Inbox (staff app). */
export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await unreadCountModel(ctx),
});

// --- Staff ------------------------------------------------------------------------------

/** Conversations addressed to the signed-in lecturer, plus the team's for super admins. */
export const inbox = query({
  args: {},
  returns: v.array(inboxConversationValidator),
  handler: async (ctx) => await listInbox(ctx),
});

// --- Housekeeping -----------------------------------------------------------------------

const RETENTION_BATCH = 10;

/**
 * Daily (crons.ts): conversations resolved more than RETENTION_MS ago are
 * deleted with their messages, a few at a time. Open ones are kept.
 * Reschedules itself while there's more to do.
 */
export const deleteExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const expired = await ctx.db
      .query("conversations")
      .withIndex("by_status_and_resolvedAt", (q) => q.eq("status", "resolved").lt("resolvedAt", cutoff))
      .take(RETENTION_BATCH);
    let deleted = 0;
    let more = expired.length === RETENTION_BATCH;
    for (const conversation of expired) {
      if (await deleteConversation(ctx, conversation._id)) deleted++;
      else more = true;
    }
    if (more) {
      await ctx.scheduler.runAfter(0, internal.messages.deleteExpired, {});
    }
    return deleted;
  },
});

/** A deleted student account: the conversations they started go, in batches (users.deleteFromClerk). */
export const deleteForStudent = internalMutation({
  args: { studentId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_studentId_and_lastMessageAt", (q) => q.eq("studentId", args.studentId))
      .take(RETENTION_BATCH);
    let more = rows.length === RETENTION_BATCH;
    for (const conversation of rows) {
      if (!(await deleteConversation(ctx, conversation._id))) more = true;
    }
    if (more) {
      await ctx.scheduler.runAfter(0, internal.messages.deleteForStudent, args);
    }
    return null;
  },
});
