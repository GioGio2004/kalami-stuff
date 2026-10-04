import { Resend, vOnEmailEventArgs } from "@convex-dev/resend";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { renderGroupInviteEmail, renderNotificationEmail } from "./lib/email/templates";
import { normalizeEmail } from "./lib/input";
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
      !user.email.includes("@")
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
 * Emails one group invite. Returns false (and sends nothing) when sending isn't
 * configured or the address is known to bounce or complain; the invite still
 * works from the student's dashboard and from the link the lecturer can copy.
 */
export async function sendGroupInviteEmail(
  ctx: MutationCtx,
  invite: { _id: Id<"groupInvites">; email: string; token: string },
  details: { inviterName: string; groupName: string },
): Promise<boolean> {
  if (!emailConfigured()) {
    return false;
  }
  const known = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(invite.email)))
    .take(5);
  if (known.some((user) => user.emailStatus !== undefined)) {
    return false;
  }
  const rendered = renderGroupInviteEmail({
    inviterName: details.inviterName,
    groupName: details.groupName,
    url: groupInviteUrl(invite.token),
  });
  const replyTo = process.env.EMAIL_REPLY_TO;
  const now = Date.now();
  const emailId = await resendClient().sendEmail(ctx, {
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

/** Scheduled by the notification fan-out, one call per batch of rows. */
export const deliver = internalMutation({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: v.number(),
  handler: async (ctx, args) => await deliverNotifications(ctx, args.notificationIds),
});

/**
 * A bounce or a spam complaint stops every further email to that address:
 * sending on would hurt deliverability for everyone else.
 */
export async function recordEmailStatus(ctx: MutationCtx, emailId: string, status: "bounced" | "complained") {
  const row = await ctx.db
    .query("notifications")
    .withIndex("by_emailId", (q) => q.eq("emailId", emailId))
    .first();
  if (row === null) {
    return;
  }
  const user = await ctx.db.get("users", row.userId);
  if (user !== null && user.emailStatus === undefined) {
    await ctx.db.patch("users", user._id, { emailStatus: status });
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
