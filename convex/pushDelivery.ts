"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { announcementPushMessage, notificationPushMessage, testPushMessage, type PushMessage } from "./lib/pushMessage";

/**
 * Sends the pushes (Node, because `web-push` encrypts the payload for each
 * device and signs the request with the VAPID key). push.ts decides what goes
 * to whom; this file only talks to the push services and reports back. Without
 * VAPID settings it does nothing, so a deployment without push still works.
 */

/** How long a push service keeps a notification for a device that's offline. */
const TTL_SECONDS = 24 * 60 * 60;

type Subscription = { _id: Id<"pushSubscriptions">; endpoint: string; keys: { p256dh: string; auth: string } };
type Results = { ok: Id<"pushSubscriptions">[]; gone: Id<"pushSubscriptions">[]; failed: Id<"pushSubscriptions">[] };

function configured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function studentAppUrl(): string {
  return (process.env.STUDENT_APP_URL ?? "https://app.kalami.space").replace(/\/+$/, "");
}

/** Loaded when first needed: a deployment without push never pays for it, and tests never import it. */
async function client() {
  const mod = await import("web-push");
  const webpush = "default" in mod && mod.default ? mod.default : mod;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:kalamispace@gmail.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return webpush;
}

/** Pushes one message to each device, sorting the devices by what their push service said. */
async function sendToAll(subscriptions: Subscription[], message: PushMessage, into: Results): Promise<void> {
  const webpush = await client();
  const payload = JSON.stringify(message);
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          payload,
          { TTL: TTL_SECONDS, urgency: "high", topic: message.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "") || undefined },
        );
        into.ok.push(subscription._id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404 and 410: the browser unsubscribed or the device is gone for good.
        if (status === 404 || status === 410) into.gone.push(subscription._id);
        else {
          into.failed.push(subscription._id);
          console.warn(`Push to ${subscription.endpoint.slice(0, 60)}… failed with ${status ?? (error as Error).message}`);
        }
      }
    }),
  );
}

async function report(ctx: ActionCtx, notificationIds: Id<"notifications">[], results: Results) {
  await ctx.runMutation(internal.push.recordResults, { notificationIds, ...results });
}

/** The notification rows a fan-out batch wrote, to every device of each student (model/notifications.ts). */
export const deliver = internalAction({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!configured() || args.notificationIds.length === 0) return null;
    const items = await ctx.runQuery(internal.push.payloadsFor, { notificationIds: args.notificationIds });
    const results: Results = { ok: [], gone: [], failed: [] };
    for (const item of items) {
      const message =
        item.kind === "announcement"
          ? announcementPushMessage({
              notificationId: item.notificationId,
              locale: item.locale,
              title: item.title,
              body: item.body ?? item.courseTitle,
              href: item.href,
              studentAppUrl: studentAppUrl(),
            })
          : notificationPushMessage({
              notificationId: item.notificationId,
              locale: item.locale,
              kind: item.kind,
              // Always set on a row about work; the fallback only satisfies the type.
              assessmentKind: item.assessmentKind ?? "task",
              title: item.title,
              courseTitle: item.courseTitle,
              dueAt: item.dueAt,
              href: item.href,
              studentAppUrl: studentAppUrl(),
            });
      await sendToAll(item.subscriptions, message, results);
    }
    await report(ctx, args.notificationIds, results);
    return null;
  },
});

/** The test push to one student's devices, with a one-line report. */
async function sendTestTo(ctx: ActionCtx, userId: Id<"users">): Promise<string> {
  if (!configured()) return "Push isn't set up on this deployment (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).";
  const devices = await ctx.runQuery(internal.push.devicesOf, { userId });
  if (devices === null) return "No such account.";
  if (devices.subscriptions.length === 0) return "This account has no device with notifications on.";
  const results: Results = { ok: [], gone: [], failed: [] };
  await sendToAll(devices.subscriptions, testPushMessage(devices.locale, studentAppUrl()), results);
  await report(ctx, [], results);
  return `Sent to ${results.ok.length} device(s); ${results.gone.length} gone (removed), ${results.failed.length} failed.`;
}

/** The "send me a test" push for one student (push.requestTest). */
export const sendTest = internalAction({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => await sendTestTo(ctx, args.userId),
});

/**
 * From the command line, for checking a deployment:
 *   npx convex run pushDelivery:sendTestByEmail '{"email":"student@example.com"}'
 */
export const sendTestByEmail = internalAction({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const userId = await ctx.runQuery(internal.push.userIdByEmail, { email: args.email });
    if (userId === null) return `No account with the email ${args.email}.`;
    return await sendTestTo(ctx, userId);
  },
});
