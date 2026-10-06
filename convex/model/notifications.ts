import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "../lib/errors";
import { verifyUnsubscribeToken } from "../lib/tokens";
import { assessmentKindValidator, notificationKindValidator, type NotificationKind } from "../lib/validators";
import { latestAttempt, type Student } from "./learn";

/**
 * Student notifications. An event (new work published, a deadline coming up)
 * becomes one row per enrolled student, written in batches by a scheduled
 * mutation so a big course never has to fit in one function call. The bell in
 * the student app reads the rows; email (email.ts) carries the same rows to
 * students who want them.
 */

const HOUR = 60 * 60 * 1000;

/** Reminders before the closing time, and the kind each one is sent as. */
export const REMINDERS: { kind: NotificationKind; before: number }[] = [
  { kind: "due_24h", before: 24 * HOUR },
  { kind: "due_1h", before: HOUR },
];
/** A reminder is dropped when the "new work" notice went out this shortly before it. */
const MIN_GAP_MS = 2 * HOUR;
/** Students told per scheduled mutation; the next batch is scheduled right after. */
export const FAN_OUT_BATCH = 100;
/** Rows the bell shows, and the most it counts as unread. */
const INBOX_SIZE = 30;
const UNREAD_CAP = 99;
/** Assessments a reminder run looks at; the next run takes the rest. */
const REMIND_BATCH = 200;

export const notificationValidator = v.object({
  _id: v.id("notifications"),
  _creationTime: v.number(),
  kind: notificationKindValidator,
  /** Absent on an announcement; so is the course. */
  assessmentKind: v.optional(assessmentKindValidator),
  title: v.string(),
  /** On an announcement: who it's from. */
  courseTitle: v.string(),
  courseId: v.optional(v.id("courses")),
  /** An announcement's text. */
  body: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  href: v.string(),
  read: v.boolean(),
});

export const inboxValidator = v.object({
  unread: v.number(),
  items: v.array(notificationValidator),
  /** Emails for new work and deadlines: on unless the person switched them off. */
  emailEnabled: v.boolean(),
  /** Resend reported the address bouncing or complaining; emails stay off until it's sorted out. */
  emailBlocked: v.boolean(),
});

function toNotification(row: Doc<"notifications">) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    kind: row.kind,
    assessmentKind: row.assessmentKind,
    title: row.title,
    courseTitle: row.courseTitle,
    courseId: row.courseId,
    body: row.body,
    dueAt: row.dueAt,
    href: row.href,
    read: row.readAt !== undefined,
  };
}

async function unreadOf(ctx: QueryCtx, userId: Id<"users">, limit: number) {
  return await ctx.db
    .query("notifications")
    .withIndex("by_userId_and_readAt", (q) => q.eq("userId", userId).eq("readAt", undefined))
    .take(limit);
}

/** Newest first, with how many are unread (capped: the badge says 99+). */
export async function getInbox(ctx: QueryCtx, student: Student) {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
    .order("desc")
    .take(INBOX_SIZE);
  const unread = await unreadOf(ctx, student.user._id, UNREAD_CAP);
  return {
    unread: unread.length,
    items: rows.map(toNotification),
    emailEnabled: student.user.emailOptOut !== true,
    emailBlocked: student.user.emailStatus !== undefined,
  };
}

export async function markRead(ctx: MutationCtx, student: Student, notificationId: Id<"notifications">) {
  const row = await ctx.db.get("notifications", notificationId);
  if (row === null || row.userId !== student.user._id) {
    throw appError("NOT_FOUND", "Notification not found.");
  }
  if (row.readAt === undefined) {
    await ctx.db.patch("notifications", notificationId, { readAt: Date.now() });
  }
}

export async function markAllRead(ctx: MutationCtx, student: Student) {
  const now = Date.now();
  for (const row of await unreadOf(ctx, student.user._id, 500)) {
    await ctx.db.patch("notifications", row._id, { readAt: now });
  }
}

// --- Email preference -----------------------------------------------------------------

export async function setEmailPreference(ctx: MutationCtx, student: Student, enabled: boolean) {
  await ctx.db.patch("users", student.user._id, { emailOptOut: enabled ? undefined : true });
}

/**
 * The link in every email: anyone holding it can switch that person's emails
 * off (never on), which is the point of an unsubscribe link. Returns false for
 * a forged or malformed one.
 */
export async function unsubscribeByToken(ctx: MutationCtx, rawUserId: string, token: string): Promise<boolean> {
  const userId = ctx.db.normalizeId("users", rawUserId);
  if (userId === null || !(await verifyUnsubscribeToken(userId, token))) {
    return false;
  }
  const user = await ctx.db.get("users", userId);
  if (user === null) {
    return false;
  }
  if (user.emailOptOut !== true) {
    await ctx.db.patch("users", userId, { emailOptOut: true });
  }
  return true;
}

// --- Sending ---------------------------------------------------------------------

async function runFor(ctx: QueryCtx, assessmentId: Id<"assessments">, kind: NotificationKind) {
  return await ctx.db
    .query("notificationRuns")
    .withIndex("by_assessmentId_and_kind", (q) => q.eq("assessmentId", assessmentId).eq("kind", kind))
    .unique();
}

/**
 * Tells every student in the assessment's course, once: a second call for the
 * same assessment and kind does nothing. The rows are written by fanOut, in
 * batches, right after this mutation commits.
 */
export async function notifyOnce(
  ctx: MutationCtx,
  assessmentId: Id<"assessments">,
  kind: NotificationKind,
): Promise<boolean> {
  if ((await runFor(ctx, assessmentId, kind)) !== null) {
    return false;
  }
  await ctx.db.insert("notificationRuns", { assessmentId, kind, at: Date.now(), sent: 0 });
  await ctx.scheduler.runAfter(0, internal.notifications.fanOut, { assessmentId, kind, cursor: null });
  return true;
}

/** Records a kind as handled without sending anything. */
async function skip(ctx: MutationCtx, assessmentId: Id<"assessments">, kind: NotificationKind) {
  await ctx.db.insert("notificationRuns", { assessmentId, kind, at: Date.now(), sent: 0 });
}

/** The path the student app opens for this work. Mirrors lib/urls.ts there. */
export function hrefFor(assessment: Doc<"assessments">): string {
  return assessment.kind === "task" ? `/tasks/${assessment._id}` : `/quizzes/${assessment._id}`;
}

/**
 * One batch of students. Reminders go only to students who haven't submitted;
 * a "new work" notice goes to everyone enrolled. Stops quietly if the work or
 * its course stopped being visible to students in the meantime. The rows it
 * wrote are handed to email delivery as one batch.
 */
export async function fanOut(
  ctx: MutationCtx,
  args: { assessmentId: Id<"assessments">; kind: NotificationKind; cursor: string | null },
): Promise<void> {
  const assessment = await ctx.db.get("assessments", args.assessmentId);
  const course = assessment === null ? null : await ctx.db.get("courses", assessment.courseId);
  if (assessment === null || course === null || assessment.status !== "published" || course.status !== "published") {
    return;
  }
  const page = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId", (q) => q.eq("courseId", course._id))
    .paginate({ numItems: FAN_OUT_BATCH, cursor: args.cursor });
  const written: Id<"notifications">[] = [];
  for (const enrollment of page.page) {
    if (enrollment.status !== "active") continue;
    if (args.kind !== "published") {
      const attempt = await latestAttempt(ctx, enrollment.userId, assessment._id);
      if (attempt?.status === "submitted") continue;
    }
    written.push(
      await ctx.db.insert("notifications", {
        userId: enrollment.userId,
        kind: args.kind,
        courseId: course._id,
        assessmentId: assessment._id,
        assessmentKind: assessment.kind,
        title: assessment.title,
        courseTitle: course.title,
        dueAt: assessment.settings.closesAt,
        href: hrefFor(assessment),
      }),
    );
  }
  const run = await runFor(ctx, assessment._id, args.kind);
  if (run !== null) {
    await ctx.db.patch("notificationRuns", run._id, { sent: run.sent + written.length });
  }
  if (written.length > 0) {
    await ctx.scheduler.runAfter(0, internal.email.deliver, { notificationIds: written });
    // The same rows to every device that turned push on (nothing happens without VAPID settings).
    await ctx.scheduler.runAfter(0, internal.pushDelivery.deliver, { notificationIds: written });
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.notifications.fanOut, { ...args, cursor: page.continueCursor });
  }
}

/**
 * Cron: for published work closing within a day, send each reminder once its
 * time comes. A reminder that would follow the "new work" notice within two
 * hours is dropped instead, so a task set the evening before isn't announced
 * twice. Returns how many reminders were started.
 */
export async function sendDueReminders(ctx: MutationCtx): Promise<number> {
  const now = Date.now();
  const horizon = Math.max(...REMINDERS.map((r) => r.before));
  const closing = await ctx.db
    .query("assessments")
    .withIndex("by_status_and_closesAt", (q) =>
      q.eq("status", "published").gt("settings.closesAt", now).lte("settings.closesAt", now + horizon),
    )
    .take(REMIND_BATCH);
  let started = 0;
  for (const assessment of closing) {
    const closesAt = assessment.settings.closesAt!;
    const publishedAt = assessment.publishedAt ?? assessment._creationTime;
    for (const { kind, before } of REMINDERS) {
      if (closesAt - now > before) continue;
      if ((await runFor(ctx, assessment._id, kind)) !== null) continue;
      if (publishedAt > closesAt - before - MIN_GAP_MS) {
        await skip(ctx, assessment._id, kind);
        continue;
      }
      if (await notifyOnce(ctx, assessment._id, kind)) started++;
    }
  }
  return started;
}
