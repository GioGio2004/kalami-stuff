import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireStudent } from "./lib/auth";
import { notificationKindValidator } from "./lib/validators";
import {
  fanOut as fanOutBatch,
  getInbox,
  inboxValidator,
  markAllRead as markAllReadFor,
  markRead as markReadFor,
  sendDueReminders,
} from "./model/notifications";

// Student app (Clerk session): the bell. Sending happens in model/notifications.ts.

export const inbox = query({
  args: {},
  returns: inboxValidator,
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    return await getInbox(ctx, student);
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await markReadFor(ctx, student, args.notificationId);
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    await markAllReadFor(ctx, student);
    return null;
  },
});

/** One batch of students for one event; schedules the next batch itself. */
export const fanOut = internalMutation({
  args: {
    assessmentId: v.id("assessments"),
    kind: notificationKindValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await fanOutBatch(ctx, args);
    return null;
  },
});

/** Every few minutes (crons.ts): deadline reminders for work closing soon. */
export const remindDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await sendDueReminders(ctx),
});
