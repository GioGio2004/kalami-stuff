import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const crons = cronJobs();

// Work still in progress when a task closes is graded as it stands (KALAMI.md §11).
crons.interval("auto-submit closed tasks", { minutes: 1 }, internal.learn.autoSubmit, {});

// "Due tomorrow" and "due in an hour" for work that is still open.
crons.interval("deadline reminders", { minutes: 5 }, internal.notifications.remindDue, {});

// The Resend component keeps every sent email's status; a week is enough to debug delivery.
// Resolved conversations go a year after they were resolved (model/messages.ts RETENTION_MS).
crons.interval("delete old conversations", { hours: 24 }, internal.messages.deleteExpired, {});

// Until every deployment has moved its old materials rows into weeks (migrations.ts).
crons.interval("move materials into weeks", { hours: 1 }, internal.migrations.materialsToWeeks, {});

crons.interval("clean up sent emails", { hours: 24 }, internal.crons.cleanupEmails, {});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const cleanupEmails = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, { olderThan: WEEK_MS });
    // Emails stuck before sending usually mean a bug; keep those around longer.
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupAbandonedEmails, { olderThan: 4 * WEEK_MS });
    return null;
  },
});

export default crons;
