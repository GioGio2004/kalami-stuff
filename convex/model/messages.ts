import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sendMessageEmails } from "../email";
import { getMemberships, isStaffRole, isSuperAdmin, requireUser } from "../lib/auth";
import { appError } from "../lib/errors";
import { requireText } from "../lib/input";
import {
  assessmentKindValidator,
  contactRecipientValidator,
  contactTopicValidator,
  conversationStatusValidator,
  localeValidator,
  type ContactRecipient,
  type ContactTopic,
} from "../lib/validators";
import { displayName, lecturerName } from "./audit";
import { publishedWeeks } from "./weeks";
import type { Student } from "./learn";

/**
 * The contact card's backend: private conversations between a student and one
 * of their lecturers, or the Kalami team (the super admins). The student picks
 * the recipient from people Kalami resolves itself (their courses' staff and
 * their groups' teachers), never from a typed address. Context (course, week,
 * assessment) is checked again here; a client can't attach someone else's.
 *
 * Who can read a conversation: the student, the chosen lecturer, and for the
 * team, a super admin. University admins and other lecturers can't, and a
 * super admin can't read a lecturer's conversations either.
 */

const MAX_BODY = 5000;
const MAX_SUBJECT = 150;
const MAX_CUSTOM_TOPIC = 80;
const MAX_LIST = 200;
const MAX_THREAD = 300;
/** Another message from the same side this soon after an emailed one doesn't email again. */
const EMAIL_COOLDOWN_MS = 5 * 60 * 1000;
/** Resolved conversations are deleted this long after they were resolved (see crons.ts). */
export const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

// --- Validators -------------------------------------------------------------------------

const contextValidator = v.object({
  course: v.optional(v.object({ _id: v.id("courses"), title: v.string(), locale: localeValidator })),
  /** The week, with the link to open: its Drive folder, or its first link. */
  week: v.optional(v.object({ _id: v.id("weeks"), title: v.string(), url: v.optional(v.string()) })),
  assessment: v.optional(v.object({ _id: v.id("assessments"), title: v.string(), kind: assessmentKindValidator })),
});

export const contactOptionsValidator = v.object({
  student: v.object({ name: v.string(), email: v.string(), locale: localeValidator }),
  /** Lecturers this student may write to, for the given course or across all their courses and groups. */
  lecturers: v.array(v.object({ userId: v.id("users"), name: v.string(), via: v.array(v.string()) })),
  /** Whether the Kalami team has anyone to receive messages. */
  adminAvailable: v.boolean(),
  context: contextValidator,
});

const conversationSummaryFields = {
  _id: v.id("conversations"),
  recipient: contactRecipientValidator,
  topic: contactTopicValidator,
  customTopic: v.optional(v.string()),
  subject: v.string(),
  status: conversationStatusValidator,
  lastMessageAt: v.number(),
  lastMessageFrom: v.union(v.literal("student"), v.literal("staff")),
  messageCount: v.number(),
  unread: v.boolean(),
  courseId: v.optional(v.id("courses")),
  courseTitle: v.optional(v.string()),
};

export const studentConversationValidator = v.object({
  ...conversationSummaryFields,
  /** "Kalami team" or the lecturer's name. */
  recipientName: v.string(),
});

export const inboxConversationValidator = v.object({
  ...conversationSummaryFields,
  studentName: v.string(),
  /** Why this person sees it: they're the lecturer, or it's for the Kalami team. */
  as: v.union(v.literal("lecturer"), v.literal("admin")),
});

export const threadValidator = v.object({
  _id: v.id("conversations"),
  viewer: v.union(v.literal("student"), v.literal("lecturer"), v.literal("admin")),
  recipient: contactRecipientValidator,
  recipientName: v.string(),
  studentName: v.string(),
  /** Staff only: the student's email, to reach them outside Kalami if needed. */
  studentEmail: v.optional(v.string()),
  topic: contactTopicValidator,
  customTopic: v.optional(v.string()),
  subject: v.string(),
  status: conversationStatusValidator,
  context: contextValidator,
  messages: v.array(
    v.object({
      _id: v.id("conversationMessages"),
      _creationTime: v.number(),
      from: v.union(v.literal("student"), v.literal("staff")),
      senderName: v.string(),
      mine: v.boolean(),
      body: v.string(),
      /** Whether a notification email went out for it (not whether anyone read it). */
      emailed: v.boolean(),
    }),
  ),
  /** True when older messages were left out (very long threads). */
  truncated: v.boolean(),
});

// --- Who and what -----------------------------------------------------------------------

async function isActiveStaff(ctx: QueryCtx, user: Doc<"users"> | null): Promise<boolean> {
  if (user === null || user.deletedAt !== undefined) {
    return false;
  }
  return (await getMemberships(ctx, user._id)).some((m) => isStaffRole(m.role));
}

async function activeEnrollment(ctx: QueryCtx, courseId: Id<"courses">, userId: Id<"users">) {
  const row = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", courseId).eq("userId", userId))
    .unique();
  return row?.status === "active" ? row : null;
}

/**
 * The lecturers the student may write to. With a course: that course's staff
 * (it must be one of the student's courses). Without: the staff of all their
 * courses and the teachers of their groups.
 */
async function lecturersFor(ctx: QueryCtx, student: Student, courseId: Id<"courses"> | undefined) {
  const found = new Map<Id<"users">, { user: Doc<"users">; via: string[] }>();
  async function add(userId: Id<"users">, via: string) {
    const existing = found.get(userId);
    if (existing) {
      if (!existing.via.includes(via)) existing.via.push(via);
      return;
    }
    const user = await ctx.db.get("users", userId);
    if (await isActiveStaff(ctx, user)) {
      found.set(userId, { user: user!, via: [via] });
    }
  }
  async function addCourseStaff(course: Doc<"courses">) {
    const staff = await ctx.db
      .query("courseStaff")
      .withIndex("by_courseId", (q) => q.eq("courseId", course._id))
      .take(20);
    for (const row of staff) await add(row.userId, course.title);
  }

  if (courseId !== undefined) {
    const course = await ctx.db.get("courses", courseId);
    if (course !== null && course.status !== "draft" && (await activeEnrollment(ctx, courseId, student.user._id))) {
      await addCourseStaff(course);
    }
  } else {
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
      .take(100);
    for (const enrollment of enrollments) {
      if (enrollment.status !== "active") continue;
      const course = await ctx.db.get("courses", enrollment.courseId);
      if (course !== null && course.status !== "draft") await addCourseStaff(course);
    }
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
      .take(100);
    for (const member of memberships) {
      const group = await ctx.db.get("groups", member.groupId);
      if (group === null) continue;
      // The lecturers who teach the group, not the admin who made it.
      const teachers = await ctx.db
        .query("groupLecturers")
        .withIndex("by_groupId_and_userId", (q) => q.eq("groupId", group._id))
        .take(50);
      for (const teacher of teachers) await add(teacher.userId, group.name);
      // A group made before groups moved to admins still reaches its owner until it's migrated.
      if (group.nameKey === undefined) await add(group.ownerId, group.name);
    }
  }
  return [...found.values()];
}

async function adminCount(ctx: QueryCtx): Promise<number> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_universityId_and_role", (q) => q.eq("universityId", undefined).eq("role", "super_admin"))
    .take(20);
  return rows.length;
}

type ContextIds = {
  courseId?: Id<"courses">;
  weekId?: Id<"weeks">;
  assessmentId?: Id<"assessments">;
};

/**
 * The course, week and assessment the student attached, if they really can see
 * them: their course, a published week of it, a published assessment of it.
 * Anything else is dropped rather than trusted.
 */
async function resolveContext(ctx: QueryCtx, studentId: Id<"users">, ids: ContextIds) {
  const out: {
    course?: { _id: Id<"courses">; title: string; locale: "ka" | "en" };
    week?: { _id: Id<"weeks">; title: string; url?: string };
    assessment?: { _id: Id<"assessments">; title: string; kind: Doc<"assessments">["kind"] };
  } = {};
  if (ids.courseId === undefined) {
    return out;
  }
  const course = await ctx.db.get("courses", ids.courseId);
  if (course === null || course.status === "draft" || !(await activeEnrollment(ctx, course._id, studentId))) {
    return out;
  }
  out.course = { _id: course._id, title: course.title, locale: course.locale };
  if (ids.weekId !== undefined) {
    const week = (await publishedWeeks(ctx, course._id)).find((w) => w._id === ids.weekId);
    if (week !== undefined) out.week = { _id: week._id, title: week.title, url: week.driveUrl ?? week.links[0]?.url };
  }
  if (ids.assessmentId !== undefined) {
    const assessment = await ctx.db.get("assessments", ids.assessmentId);
    if (assessment !== null && assessment.courseId === course._id && assessment.status !== "draft") {
      out.assessment = { _id: assessment._id, title: assessment.title, kind: assessment.kind };
    }
  }
  return out;
}

function contextLine(context: Awaited<ReturnType<typeof resolveContext>>): string | undefined {
  const parts = [context.course?.title, context.week?.title, context.assessment?.title].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

type Viewer = { user: Doc<"users">; as: "student" | "lecturer" | "admin" };

/** The signed-in person's role in this conversation. Everyone else gets NOT_FOUND. */
async function requireViewer(ctx: QueryCtx, conversationId: Id<"conversations">) {
  const user = await requireUser(ctx);
  const conversation = await ctx.db.get("conversations", conversationId);
  if (conversation !== null) {
    if (conversation.studentId === user._id) {
      return { conversation, viewer: { user, as: "student" } as Viewer };
    }
    if (conversation.recipient === "lecturer" && conversation.lecturerId === user._id && (await isActiveStaff(ctx, user))) {
      return { conversation, viewer: { user, as: "lecturer" } as Viewer };
    }
    if (conversation.recipient === "admin" && isSuperAdmin(await getMemberships(ctx, user._id))) {
      return { conversation, viewer: { user, as: "admin" } as Viewer };
    }
  }
  throw appError("NOT_FOUND", "Conversation not found.");
}

async function lastReadAt(ctx: QueryCtx, conversationId: Id<"conversations">, userId: Id<"users">) {
  const row = await ctx.db
    .query("conversationReads")
    .withIndex("by_userId_and_conversationId", (q) => q.eq("userId", userId).eq("conversationId", conversationId))
    .unique();
  return row?.lastReadAt ?? 0;
}

async function markReadAt(ctx: MutationCtx, conversationId: Id<"conversations">, userId: Id<"users">, at: number) {
  const row = await ctx.db
    .query("conversationReads")
    .withIndex("by_userId_and_conversationId", (q) => q.eq("userId", userId).eq("conversationId", conversationId))
    .unique();
  if (row === null) {
    await ctx.db.insert("conversationReads", { conversationId, userId, lastReadAt: at });
  } else if (row.lastReadAt < at) {
    await ctx.db.patch("conversationReads", row._id, { lastReadAt: at });
  }
}

/** Unread for this person: the other side wrote after they last looked. */
async function isUnread(ctx: QueryCtx, conversation: Doc<"conversations">, user: Doc<"users">, side: "student" | "staff") {
  if (conversation.lastMessageFrom === side) {
    return false;
  }
  return conversation.lastMessageAt > (await lastReadAt(ctx, conversation._id, user._id));
}

/** The lecturer as the viewer may see them: students get a name only, never an email address. */
async function recipientName(ctx: QueryCtx, conversation: Doc<"conversations">, viewer: "student" | "staff") {
  if (conversation.recipient === "admin") {
    return "Kalami team";
  }
  if (conversation.lecturerId === undefined) {
    return "Lecturer";
  }
  const lecturer = await ctx.db.get("users", conversation.lecturerId);
  return viewer === "student" ? lecturerName(lecturer) : displayName(lecturer);
}

async function courseTitle(ctx: QueryCtx, courseId: Id<"courses"> | undefined) {
  return courseId === undefined ? undefined : (await ctx.db.get("courses", courseId))?.title;
}

// --- Students ---------------------------------------------------------------------------

export async function contactOptions(ctx: QueryCtx, student: Student, ids: ContextIds) {
  const context = await resolveContext(ctx, student.user._id, ids);
  const lecturers = await lecturersFor(ctx, student, context.course?._id);
  return {
    student: { name: displayName(student.user), email: student.user.email, locale: student.user.locale },
    lecturers: lecturers
      .map(({ user, via }) => ({ userId: user._id, name: lecturerName(user), via }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    adminAvailable: (await adminCount(ctx)) > 0,
    context,
  };
}

async function existingByOp(ctx: QueryCtx, senderId: Id<"users">, clientOpId: string) {
  return await ctx.db
    .query("conversationMessages")
    .withIndex("by_senderId_and_clientOpId", (q) => q.eq("senderId", senderId).eq("clientOpId", clientOpId))
    .first();
}

/**
 * The conversation this send already started, for a retried `start`. Only a
 * match that opened a conversation of this student counts; anything else with
 * the same id is a client bug, refused rather than silently merged.
 */
export async function alreadyStarted(ctx: QueryCtx, student: Student, clientOpId: string) {
  const earlier = await existingByOp(ctx, student.user._id, clientOpId);
  if (earlier === null) {
    return null;
  }
  const conversation = await ctx.db.get("conversations", earlier.conversationId);
  const first = await ctx.db
    .query("conversationMessages")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", earlier.conversationId))
    .first();
  if (conversation?.studentId !== student.user._id || first?._id !== earlier._id) {
    throw appError("CONFLICT", "Something went wrong preparing the message. Reload and try again.");
  }
  return conversation._id;
}

/** The message this send already added, for a retried `reply`; it must be in the same conversation. */
export async function alreadyReplied(ctx: QueryCtx, conversationId: Id<"conversations">, senderId: Id<"users">, clientOpId: string) {
  const earlier = await existingByOp(ctx, senderId, clientOpId);
  if (earlier === null) {
    return null;
  }
  if (earlier.conversationId !== conversationId) {
    throw appError("CONFLICT", "Something went wrong preparing the message. Reload and try again.");
  }
  return earlier._id;
}

function requireOpId(clientOpId: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientOpId)) {
    throw appError("INVALID_INPUT", "Something went wrong preparing the message. Reload and try again.");
  }
  return clientOpId;
}

/** Adds the message, updates the conversation, marks it read for the sender and queues the emails. */
async function addMessage(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  sender: Viewer,
  body: string,
  clientOpId: string,
  context: string | undefined,
) {
  const from = sender.as === "student" ? ("student" as const) : ("staff" as const);
  const now = Date.now();
  // A burst of messages from the same side emails once; the next one after a pause emails again.
  const previous = await ctx.db
    .query("conversationMessages")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
    .order("desc")
    .first();
  const coolingDown =
    previous !== null &&
    previous.from === from &&
    (previous.emailIds?.length ?? 0) > 0 &&
    now - previous._creationTime < EMAIL_COOLDOWN_MS;

  const messageId = await ctx.db.insert("conversationMessages", {
    conversationId: conversation._id,
    senderId: sender.user._id,
    from,
    body,
    clientOpId,
  });
  const status = from === "student" ? ("open" as const) : ("answered" as const);
  const updated: Doc<"conversations"> = {
    ...conversation,
    status,
    resolvedAt: undefined,
    lastMessageAt: now,
    lastMessageFrom: from,
    messageCount: conversation.messageCount + 1,
  };
  await ctx.db.patch("conversations", conversation._id, {
    status,
    resolvedAt: undefined,
    lastMessageAt: now,
    lastMessageFrom: from,
    messageCount: updated.messageCount,
  });
  await markReadAt(ctx, conversation._id, sender.user._id, now);
  if (coolingDown) {
    await ctx.db.patch("conversationMessages", messageId, { emailSkipped: "Sent moments after the previous email." });
  } else {
    const { emailIds, skipped } = await sendMessageEmails(ctx, updated, { _id: messageId, senderId: sender.user._id, from, body }, context);
    await ctx.db.patch("conversationMessages", messageId, { emailIds, emailSkipped: skipped });
  }
  return messageId;
}

export async function startConversation(
  ctx: MutationCtx,
  student: Student,
  args: ContextIds & {
    clientOpId: string;
    recipient: ContactRecipient;
    lecturerId?: Id<"users">;
    topic: ContactTopic;
    customTopic?: string;
    subject: string;
    body: string;
  },
): Promise<Id<"conversations">> {
  const clientOpId = requireOpId(args.clientOpId);
  const earlier = await alreadyStarted(ctx, student, clientOpId);
  if (earlier !== null) {
    return earlier;
  }
  const subject = requireText(args.subject, "Subject", MAX_SUBJECT);
  const body = requireText(args.body, "Message", MAX_BODY);
  const customTopic = args.topic === "other" ? requireText(args.customTopic ?? "", "Topic", MAX_CUSTOM_TOPIC) : undefined;
  const context = await resolveContext(ctx, student.user._id, args);

  let lecturerId: Id<"users"> | undefined;
  if (args.recipient === "lecturer") {
    const allowed = await lecturersFor(ctx, student, context.course?._id);
    const chosen = allowed.find((l) => l.user._id === args.lecturerId);
    if (chosen === undefined) {
      throw appError("FORBIDDEN", "Choose one of your own lecturers.");
    }
    lecturerId = chosen.user._id;
  } else if ((await adminCount(ctx)) === 0) {
    throw appError("CONFLICT", "The Kalami team can't receive messages right now. Write to your lecturer instead.");
  }

  const now = Date.now();
  const conversationId = await ctx.db.insert("conversations", {
    studentId: student.user._id,
    recipient: args.recipient,
    lecturerId,
    courseId: context.course?._id,
    weekId: context.week?._id,
    assessmentId: context.assessment?._id,
    topic: args.topic,
    customTopic,
    subject,
    status: "open",
    lastMessageAt: now,
    lastMessageFrom: "student",
    messageCount: 0,
  });
  const conversation = (await ctx.db.get("conversations", conversationId))!;
  await addMessage(ctx, conversation, { user: student.user, as: "student" }, body, clientOpId, contextLine(context));
  return conversationId;
}

export async function listStudentConversations(ctx: QueryCtx, student: Student) {
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_studentId_and_lastMessageAt", (q) => q.eq("studentId", student.user._id))
    .order("desc")
    .take(MAX_LIST);
  const out = [];
  for (const row of rows) {
    out.push({
      ...summaryOf(row),
      unread: await isUnread(ctx, row, student.user, "student"),
      courseTitle: await courseTitle(ctx, row.courseId),
      recipientName: await recipientName(ctx, row, "student"),
    });
  }
  return out;
}

function summaryOf(row: Doc<"conversations">) {
  return {
    _id: row._id,
    recipient: row.recipient,
    topic: row.topic,
    customTopic: row.customTopic,
    subject: row.subject,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    lastMessageFrom: row.lastMessageFrom,
    messageCount: row.messageCount,
    courseId: row.courseId,
  };
}

// --- Both sides -------------------------------------------------------------------------

export async function getThread(ctx: QueryCtx, conversationId: Id<"conversations">) {
  const { conversation, viewer } = await requireViewer(ctx, conversationId);
  const rows = await ctx.db
    .query("conversationMessages")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .take(MAX_THREAD + 1);
  const truncated = rows.length > MAX_THREAD;
  const names = new Map<Id<"users">, string>();
  const messages = [];
  for (const row of rows.slice(0, MAX_THREAD).reverse()) {
    let name = names.get(row.senderId);
    if (name === undefined) {
      const sender = await ctx.db.get("users", row.senderId);
      name = viewer.as === "student" && row.from === "staff" ? lecturerName(sender) : displayName(sender);
      names.set(row.senderId, name);
    }
    messages.push({
      _id: row._id,
      _creationTime: row._creationTime,
      from: row.from,
      // The team speaks as the team to students; staff see who answered.
      senderName: row.from === "staff" && conversation.recipient === "admin" && viewer.as === "student" ? "Kalami team" : name,
      mine: row.senderId === viewer.user._id,
      body: row.body,
      emailed: (row.emailIds?.length ?? 0) > 0,
    });
  }
  const student = await ctx.db.get("users", conversation.studentId);
  return {
    _id: conversation._id,
    viewer: viewer.as,
    recipient: conversation.recipient,
    recipientName: await recipientName(ctx, conversation, viewer.as === "student" ? "student" : "staff"),
    studentName: displayName(student),
    studentEmail: viewer.as === "student" || student === null || student.deletedAt !== undefined ? undefined : student.email,
    topic: conversation.topic,
    customTopic: conversation.customTopic,
    subject: conversation.subject,
    status: conversation.status,
    context: await resolveContext(ctx, conversation.studentId, conversation),
    messages,
    truncated,
  };
}

export async function reply(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
  args: { clientOpId: string; body: string },
): Promise<Id<"conversationMessages">> {
  const { conversation, viewer } = await requireViewer(ctx, conversationId);
  const clientOpId = requireOpId(args.clientOpId);
  const earlier = await alreadyReplied(ctx, conversationId, viewer.user._id, clientOpId);
  if (earlier !== null) {
    return earlier;
  }
  const body = requireText(args.body, "Message", MAX_BODY);
  // A lecturer who left can't read it any more; say so instead of writing into the void.
  if (viewer.as === "student" && conversation.recipient === "lecturer" && conversation.lecturerId !== undefined) {
    const lecturer = await ctx.db.get("users", conversation.lecturerId);
    if (!(await isActiveStaff(ctx, lecturer))) {
      throw appError(
        "CONFLICT",
        `${lecturerName(lecturer)} no longer teaches on Kalami, so they won't see this. Write a new message to another lecturer or to Admin.`,
      );
    }
  }
  const context = await resolveContext(ctx, conversation.studentId, conversation);
  return await addMessage(ctx, conversation, viewer, body, clientOpId, contextLine(context));
}

/** Either side may close it, and reopen it; a new message reopens it too. */
export async function setResolved(ctx: MutationCtx, conversationId: Id<"conversations">, resolved: boolean) {
  const { conversation } = await requireViewer(ctx, conversationId);
  if (resolved) {
    if (conversation.status !== "resolved") {
      await ctx.db.patch("conversations", conversationId, { status: "resolved", resolvedAt: Date.now() });
    }
  } else if (conversation.status === "resolved") {
    await ctx.db.patch("conversations", conversationId, {
      status: conversation.lastMessageFrom === "student" ? "open" : "answered",
      resolvedAt: undefined,
    });
  }
}

export async function markRead(ctx: MutationCtx, conversationId: Id<"conversations">) {
  const { conversation, viewer } = await requireViewer(ctx, conversationId);
  await markReadAt(ctx, conversationId, viewer.user._id, conversation.lastMessageAt);
}

/** Conversations this person still has to read, for the badge in either app's navigation. */
export async function unreadCount(ctx: QueryCtx): Promise<number> {
  const user = await requireUser(ctx);
  let count = 0;
  const own = await ctx.db
    .query("conversations")
    .withIndex("by_studentId_and_lastMessageAt", (q) => q.eq("studentId", user._id))
    .order("desc")
    .take(MAX_LIST);
  for (const row of own) {
    if (await isUnread(ctx, row, user, "student")) count++;
  }
  for (const row of await inboxRows(ctx, user)) {
    if (row.conversation.status !== "resolved" && (await isUnread(ctx, row.conversation, user, "staff"))) count++;
  }
  return count;
}

// --- Staff ------------------------------------------------------------------------------

async function inboxRows(ctx: QueryCtx, user: Doc<"users">) {
  const memberships = await getMemberships(ctx, user._id);
  if (!memberships.some((m) => isStaffRole(m.role))) {
    return [];
  }
  const rows: { conversation: Doc<"conversations">; as: "lecturer" | "admin" }[] = [];
  const mine = await ctx.db
    .query("conversations")
    .withIndex("by_lecturerId_and_lastMessageAt", (q) => q.eq("lecturerId", user._id))
    .order("desc")
    .take(MAX_LIST);
  for (const conversation of mine) rows.push({ conversation, as: "lecturer" });
  if (isSuperAdmin(memberships)) {
    const team = await ctx.db
      .query("conversations")
      .withIndex("by_recipient_and_lastMessageAt", (q) => q.eq("recipient", "admin"))
      .order("desc")
      .take(MAX_LIST);
    for (const conversation of team) rows.push({ conversation, as: "admin" });
  }
  rows.sort((a, b) => b.conversation.lastMessageAt - a.conversation.lastMessageAt);
  return rows;
}

export async function listInbox(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const out = [];
  for (const { conversation, as } of await inboxRows(ctx, user)) {
    out.push({
      ...summaryOf(conversation),
      unread: await isUnread(ctx, conversation, user, "staff"),
      courseTitle: await courseTitle(ctx, conversation.courseId),
      studentName: displayName(await ctx.db.get("users", conversation.studentId)),
      as,
    });
  }
  return out;
}

// --- Housekeeping -----------------------------------------------------------------------

const DELETE_MESSAGES_BATCH = 200;

/**
 * Deletes up to a batch of one conversation's messages, and the conversation
 * itself once none are left. Returns true when it's gone; callers call again
 * (in a new mutation) until then, so no transaction grows without bound.
 */
export async function deleteConversation(ctx: MutationCtx, conversationId: Id<"conversations">): Promise<boolean> {
  const messages = await ctx.db
    .query("conversationMessages")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .take(DELETE_MESSAGES_BATCH);
  for (const message of messages) {
    await ctx.db.delete("conversationMessages", message._id);
  }
  if (messages.length === DELETE_MESSAGES_BATCH) {
    return false;
  }
  for (const read of await ctx.db
    .query("conversationReads")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .take(50)) {
    await ctx.db.delete("conversationReads", read._id);
  }
  await ctx.db.delete("conversations", conversationId);
  return true;
}
