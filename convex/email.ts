import { Resend, vOnEmailEventArgs } from "@convex-dev/resend";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  renderGroupInviteEmail,
  renderNotificationEmail,
  renderStaffMessageEmail,
  renderStudentReplyEmail,
} from "./lib/email/templates";
import { normalizeEmail } from "./lib/input";
import { getMemberships, isStaffRole } from "./lib/auth";
import { unsubscribeToken } from "./lib/tokens";

/**
 * Notification emails through Resend. The component queues, batches, retries
 * and deduplicates; this file decides who gets what. A notification row is the
 * source of truth (see model/notifications.ts): the bell shows it, and if the
 * person hasn't switched emails off and their address is in good standing,
 * one email carries it too.
 *
 * Deployment settings (Convex env): RESEND_API_KEY (required to send),
 * RESEND_WEBHOOK_SECRET (delivery events, optional), EMAIL_FROM (defaults to
 * Kalami <notifications@kalami.space>), EMAIL_REPLY_TO (optional),
 * STUDENT_APP_URL (links; defaults to https://app.kalami.space),
 * STAFF_APP_URL (links in message emails to staff; defaults to https://staff.kalami.space),
 * RESEND_TEST_MODE=true to only allow Resend's test addresses.
 */

/**
 * Built per call rather than once at module load, so the settings are read when
 * a function runs (and tests can change them); the client is a thin wrapper.
 */
export function resendClient(): Resend {
  return new Resend(components.resend, {
    apiKey: process.env.RESEND_API_KEY,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    testMode: process.env.RESEND_TEST_MODE === "true",
    onEmailEvent: internal.email.handleEvent,
  });
}

function from(): string {
  return process.env.EMAIL_FROM ?? "Kalami <notifications@kalami.space>";
}

function studentAppUrl(): string {
  return (process.env.STUDENT_APP_URL ?? "https://app.kalami.space").replace(/\/+$/, "");
}

function staffAppUrl(): string {
  return (process.env.STAFF_APP_URL ?? "https://staff.kalami.space").replace(/\/+$/, "");
}

/** The backend's own HTTP origin (https://<deployment>.convex.site), where the unsubscribe page lives. */
function siteUrl(): string | null {
  const url = process.env.CONVEX_SITE_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Queues one email per notification that still wants one. Skips quietly when
 * sending isn't configured, the person opted out, their address bounced or
 * complained, the account was deleted, or the row was already emailed.
 */
export async function deliverNotifications(ctx: MutationCtx, notificationIds: Id<"notifications">[]): Promise<number> {
  if (!emailConfigured()) {
    return 0;
  }
  const site = siteUrl();
  let queued = 0;
  for (const notificationId of notificationIds) {
    const row = await ctx.db.get("notifications", notificationId);
    if (row === null || row.emailId !== undefined) continue;
    const user = await ctx.db.get("users", row.userId);
    if (
      user === null ||
      user.deletedAt !== undefined ||
      user.emailOptOut === true ||
      user.emailStatus !== undefined ||
      !canSendTo(user.email)
    ) {
      continue;
    }
    const token = await unsubscribeToken(user._id);
    if (token === null || site === null) {
      // No secret or no site URL: nothing to put in the unsubscribe link, so no email.
      continue;
    }
    const unsubscribeUrl = `${site}/email/unsubscribe?u=${user._id}&t=${token}`;
    const rendered = renderNotificationEmail({
      locale: user.locale,
      firstName: user.firstName,
      kind: row.kind,
      assessmentKind: row.assessmentKind,
      title: row.title,
      courseTitle: row.courseTitle,
      dueAt: row.dueAt,
      url: `${studentAppUrl()}${row.href}`,
      unsubscribeUrl,
    });
    const replyTo = process.env.EMAIL_REPLY_TO;
    const emailId = await resendClient().sendEmail(ctx, {
      from: from(),
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: replyTo ? [replyTo] : undefined,
      // RFC 8058 one-click unsubscribe: mail clients show their own "Unsubscribe" button for it.
      headers: [
        { name: "List-Unsubscribe", value: `<${unsubscribeUrl}>` },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
      // A retried fan-out or a resent batch never produces a second email for the same row.
      idempotencyKey: `notification:${row._id}`,
    });
    await ctx.db.patch("notifications", row._id, { emailId, emailedAt: Date.now() });
    queued++;
  }
  return queued;
}

/**
 * Whether this address may be emailed at all: sending is configured, and in
 * Resend's test mode only its own test addresses (the component refuses the
 * rest by throwing, which would undo the whole mutation).
 */
function canSendTo(email: string): boolean {
  if (!emailConfigured() || !email.includes("@")) {
    return false;
  }
  return process.env.RESEND_TEST_MODE !== "true" || email.toLowerCase().endsWith("@resend.dev");
}

/** Bounced or complained before, as a Kalami user or as an invite address. */
async function isSuppressed(ctx: MutationCtx, email: string): Promise<boolean> {
  const address = normalizeEmail(email);
  const suppressed = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q) => q.eq("email", address))
    .first();
  if (suppressed !== null) {
    return true;
  }
  const users = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", address))
    .take(5);
  return users.some((user) => user.emailStatus !== undefined);
}

/** Queues one email and remembers where it went, so a bounce can be traced back. */
type LoggedEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string[];
  idempotencyKey: string;
};

async function sendLogged(ctx: MutationCtx, options: LoggedEmail): Promise<string> {
  const emailId = await resendClient().sendEmail(ctx, options);
  await ctx.db.insert("emailLog", { emailId, email: normalizeEmail(options.to) });
  return emailId;
}

/**
 * Emails one group invite. Returns false (and sends nothing) when sending isn't
 * configured or the address is known to bounce or complain; the invite still
 * works from the student's dashboard and from the link the lecturer can copy.
 */
export async function sendGroupInviteEmail(
  ctx: MutationCtx,
  invite: { _id: Id<"groupInvites">; email: string; token: string },
  details: { inviterName: string; groupName: string },
): Promise<boolean> {
  if (!canSendTo(invite.email) || (await isSuppressed(ctx, invite.email))) {
    return false;
  }
  const rendered = renderGroupInviteEmail({
    inviterName: details.inviterName,
    groupName: details.groupName,
    url: groupInviteUrl(invite.token),
  });
  const replyTo = process.env.EMAIL_REPLY_TO;
  const now = Date.now();
  const emailId = await sendLogged(ctx, {
    from: from(),
    to: invite.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: replyTo ? [replyTo] : undefined,
    // A resend is a new email on purpose; a retried mutation within the same minute isn't.
    idempotencyKey: `group-invite:${invite._id}:${Math.floor(now / 60_000)}`,
  });
  await ctx.db.patch("groupInvites", invite._id, { emailId, emailedAt: now });
  return true;
}

/** Where a personal group invite opens in the student app. */
export function groupInviteUrl(token: string): string {
  return `${studentAppUrl()}/join/invite/${token}`;
}

/** A person's name; never their email, which the other side shouldn't learn from Kalami. */
function nameOf(user: Doc<"users">, fallback: string): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || fallback;
}

function canEmail(user: Doc<"users"> | null): user is Doc<"users"> {
  return user !== null && user.deletedAt === undefined && user.emailStatus === undefined && canSendTo(user.email);
}

async function isActiveStaff(ctx: MutationCtx, user: Doc<"users">): Promise<boolean> {
  return (await getMemberships(ctx, user._id)).some((m) => isStaffRole(m.role));
}

/** `"Ana Beridze via Kalami" <notifications@…>`, quoted so commas or @ in a name can't break the header. */
function viaKalami(name: string): string {
  const safe = name.replace(/[\r\n]/g, " ").replace(/[\\"]/g, "\\$&").slice(0, 60);
  return `"${safe} via Kalami" <${fromAddress()}>`;
}

/**
 * The notification emails for one new message: to the lecturer, or to every
 * super admin (the Kalami team), when a student writes; to the student when
 * staff reply, unless they switched emails off. Queued in the same
 * transaction as the message, so a saved message always has its emails and a
 * failed save has none. Returns the queued ids, or why nothing was sent.
 */
export async function sendMessageEmails(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  message: { _id: Id<"conversationMessages">; senderId: Id<"users">; from: "student" | "staff"; body: string },
  context: string | undefined,
): Promise<{ emailIds: string[]; skipped?: string }> {
  if (!emailConfigured()) {
    return { emailIds: [], skipped: "Email isn't set up on this server." };
  }
  const sender = await ctx.db.get("users", message.senderId);
  if (sender === null) {
    return { emailIds: [], skipped: "Sender not found." };
  }
  const emailIds: string[] = [];
  if (message.from === "student") {
    const recipients: Doc<"users">[] = [];
    if (conversation.recipient === "lecturer" && conversation.lecturerId !== undefined) {
      const lecturer = await ctx.db.get("users", conversation.lecturerId);
      // Someone who lost their staff role can't open the conversation, so they don't get it by email either.
      if (canEmail(lecturer) && (await isActiveStaff(ctx, lecturer))) recipients.push(lecturer);
    } else if (conversation.recipient === "admin") {
      const admins = await ctx.db
        .query("memberships")
        .withIndex("by_universityId_and_role", (q) => q.eq("universityId", undefined).eq("role", "super_admin"))
        .take(20);
      for (const membership of admins) {
        const admin = await ctx.db.get("users", membership.userId);
        if (canEmail(admin) && admin._id !== sender._id) recipients.push(admin);
      }
    }
    for (const recipient of recipients) {
      if (await isSuppressed(ctx, recipient.email)) continue;
      const studentName = nameOf(sender, "A student");
      const rendered = renderStaffMessageEmail({
        locale: recipient.locale,
        studentName,
        subject: conversation.subject,
        context,
        body: message.body,
        isReply: conversation.messageCount > 1,
        url: `${staffAppUrl()}/inbox/${conversation._id}`,
      });
      emailIds.push(
        await sendLogged(ctx, {
          from: viaKalami(studentName),
          to: recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `message:${message._id}:${recipient._id}`,
        }),
      );
    }
    return emailIds.length > 0 ? { emailIds } : { emailIds, skipped: "Nobody to email." };
  }

  const student = await ctx.db.get("users", conversation.studentId);
  if (!canEmail(student) || student.emailOptOut === true || (await isSuppressed(ctx, student.email))) {
    return { emailIds, skipped: "The student doesn't get emails." };
  }
  const token = await unsubscribeToken(student._id);
  const site = siteUrl();
  if (token === null || site === null) {
    return { emailIds, skipped: "No unsubscribe link available." };
  }
  const rendered = renderStudentReplyEmail({
    locale: student.locale,
    staffName: conversation.recipient === "admin" ? "Kalami" : nameOf(sender, student.locale === "ka" ? "ლექტორი" : "Your lecturer"),
    subject: conversation.subject,
    url: `${studentAppUrl()}/messages/${conversation._id}`,
    unsubscribeUrl: `${site}/email/unsubscribe?u=${student._id}&t=${token}`,
  });
  emailIds.push(
    await sendLogged(ctx, {
      from: from(),
      to: student.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `message:${message._id}:${student._id}`,
    }),
  );
  return { emailIds };
}

/** The bare address inside EMAIL_FROM, so a person's name can go in front of it. */
function fromAddress(): string {
  const configured = from();
  return /<([^>]+)>/.exec(configured)?.[1] ?? configured;
}

/** Scheduled by the notification fan-out, one call per batch of rows. */
export const deliver = internalMutation({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: v.number(),
  handler: async (ctx, args) => await deliverNotifications(ctx, args.notificationIds),
});

/**
 * A bounce or a spam complaint stops every further email to that address:
 * sending on would hurt deliverability for everyone else. Notification emails
 * are traced through their row, invite and message emails through emailLog;
 * addresses without an account are remembered in emailSuppressions.
 */
export async function recordEmailStatus(ctx: MutationCtx, emailId: string, status: "bounced" | "complained") {
  let address: string | null = null;
  const row = await ctx.db
    .query("notifications")
    .withIndex("by_emailId", (q) => q.eq("emailId", emailId))
    .first();
  if (row !== null) {
    address = (await ctx.db.get("users", row.userId))?.email ?? null;
  } else {
    address =
      (
        await ctx.db
          .query("emailLog")
          .withIndex("by_emailId", (q) => q.eq("emailId", emailId))
          .first()
      )?.email ?? null;
  }
  if (address === null) {
    return;
  }
  const users = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", address))
    .take(5);
  for (const user of users) {
    if (user.emailStatus === undefined) {
      await ctx.db.patch("users", user._id, { emailStatus: status });
    }
  }
  const existing = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q) => q.eq("email", address))
    .first();
  if (existing === null) {
    await ctx.db.insert("emailSuppressions", { email: address, status, at: Date.now() });
  }
}

/** Resend's delivery events, through the webhook in http.ts. */
export const handleEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, { id, event }) => {
    if (event.type === "email.bounced") {
      await recordEmailStatus(ctx, id, "bounced");
    } else if (event.type === "email.complained") {
      await recordEmailStatus(ctx, id, "complained");
    }
    return null;
  },
});
