import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireStudent } from "./lib/auth";
import { appError } from "./lib/errors";
import { normalizeEmail } from "./lib/input";
import { enforceLimit } from "./lib/limits";
import { assessmentKindValidator, localeValidator, notificationKindValidator } from "./lib/validators";

/**
 * Web Push for the student app. A device that turned notifications on is a
 * `pushSubscriptions` row; the same notification rows the bell shows and the
 * email carries are pushed to every device of the student (pushDelivery.ts,
 * a Node action, does the sending). Settings: VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:…) on the Convex deployment;
 * without them nothing is pushed and nothing fails.
 */

/** Devices one student can have on; the oldest goes when one more comes. */
const MAX_PER_USER = 8;
/** Failed pushes in a row (not "gone", which removes at once) before a device is dropped. */
const MAX_FAILURES = 5;

const keysValidator = v.object({ p256dh: v.string(), auth: v.string() });

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The key the browser subscribes with. Public by nature; null until the deployment is set up. */
export const vapidPublicKey = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => (pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null),
});

async function byEndpoint(ctx: QueryCtx, endpoint: string) {
  return await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
    .unique();
}

async function ofUser(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(MAX_PER_USER * 2);
}

/** This device wants pushes for the signed-in student. Calling it again refreshes the row. */
export const subscribe = mutation({
  args: { endpoint: v.string(), keys: keysValidator, userAgent: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "pushSubscribe", student.user._id);
    const endpoint = args.endpoint.trim();
    if (!/^https:\/\/\S{8,2000}$/.test(endpoint) || args.keys.p256dh.length > 256 || args.keys.auth.length > 128) {
      throw appError("INVALID_INPUT", "That subscription doesn't look right.");
    }
    const userAgent = args.userAgent?.slice(0, 200);
    const now = Date.now();
    const existing = await byEndpoint(ctx, endpoint);
    if (existing !== null) {
      // The same device, maybe with another account signed in now: it follows whoever uses it.
      await ctx.db.patch("pushSubscriptions", existing._id, {
        userId: student.user._id,
        keys: args.keys,
        userAgent,
        lastUsedAt: now,
        failures: 0,
      });
      return null;
    }
    const mine = (await ofUser(ctx, student.user._id)).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const row of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) {
      await ctx.db.delete("pushSubscriptions", row._id);
    }
    await ctx.db.insert("pushSubscriptions", {
      userId: student.user._id,
      endpoint,
      keys: args.keys,
      userAgent,
      lastUsedAt: now,
      failures: 0,
    });
    return null;
  },
});

/** This device no longer wants pushes. Fine to call for a device that's already gone. */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await requireStudent(ctx);
    const row = await byEndpoint(ctx, args.endpoint.trim());
    if (row !== null && row.userId === student.user._id) {
      await ctx.db.delete("pushSubscriptions", row._id);
    }
    return null;
  },
});

/** The student's devices, so the app knows whether this one is on. */
export const mine = query({
  args: {},
  returns: v.array(v.object({ endpoint: v.string(), userAgent: v.optional(v.string()), lastUsedAt: v.number() })),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    const rows = await ofUser(ctx, student.user._id);
    return rows.map((row) => ({ endpoint: row.endpoint, userAgent: row.userAgent, lastUsedAt: row.lastUsedAt }));
  },
});

/** The "send me a test" button: a push to every device of the student. Returns how many devices. */
export const requestTest = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const student = await requireStudent(ctx);
    await enforceLimit(ctx, "pushTest", student.user._id);
    const devices = (await ofUser(ctx, student.user._id)).length;
    if (devices > 0 && pushConfigured()) {
      await ctx.scheduler.runAfter(0, internal.pushDelivery.sendTest, { userId: student.user._id });
    }
    return devices;
  },
});

// --- For pushDelivery.ts ---------------------------------------------------------------------

const subscriptionValidator = v.object({
  _id: v.id("pushSubscriptions"),
  endpoint: v.string(),
  keys: keysValidator,
});

export const deliveryValidator = v.object({
  notificationId: v.id("notifications"),
  locale: localeValidator,
  kind: notificationKindValidator,
  assessmentKind: v.optional(assessmentKindValidator),
  title: v.string(),
  courseTitle: v.string(),
  /** An announcement's text. */
  body: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  href: v.string(),
  subscriptions: v.array(subscriptionValidator),
});

function toSubscription(row: Doc<"pushSubscriptions">) {
  return { _id: row._id, endpoint: row.endpoint, keys: row.keys };
}

/** Notification rows not yet pushed, each with the devices of its student (none: nothing to send). */
export const payloadsFor = internalQuery({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: v.array(deliveryValidator),
  handler: async (ctx, args) => {
    const out = [];
    for (const notificationId of args.notificationIds) {
      const row = await ctx.db.get("notifications", notificationId);
      if (row === null || row.pushedAt !== undefined) continue;
      const user = await ctx.db.get("users", row.userId);
      if (user === null || user.deletedAt !== undefined) continue;
      const subscriptions = await ofUser(ctx, user._id);
      if (subscriptions.length === 0) continue;
      out.push({
        notificationId: row._id,
        locale: user.locale,
        kind: row.kind,
        assessmentKind: row.assessmentKind,
        title: row.title,
        courseTitle: row.courseTitle,
        body: row.body,
        dueAt: row.dueAt,
        href: row.href,
        subscriptions: subscriptions.map(toSubscription),
      });
    }
    return out;
  },
});

/** One student's devices and language, for the test push. */
export const devicesOf = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.object({ locale: localeValidator, subscriptions: v.array(subscriptionValidator) })),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (user === null || user.deletedAt !== undefined) return null;
    return { locale: user.locale, subscriptions: (await ofUser(ctx, user._id)).map(toSubscription) };
  },
});

/** For the CLI test: the account with this email. */
export const userIdByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .take(2);
    const user = rows.find((row) => row.deletedAt === undefined);
    return user?._id ?? null;
  },
});

/**
 * What came back from the push services: devices that are gone are removed,
 * ones that failed for another reason count a strike (dropped after
 * MAX_FAILURES in a row), ones that worked are fresh again. The notifications
 * are marked as pushed either way, so a retried batch doesn't send them twice.
 */
export const recordResults = internalMutation({
  args: {
    notificationIds: v.array(v.id("notifications")),
    ok: v.array(v.id("pushSubscriptions")),
    gone: v.array(v.id("pushSubscriptions")),
    failed: v.array(v.id("pushSubscriptions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.gone) {
      if ((await ctx.db.get("pushSubscriptions", id)) !== null) await ctx.db.delete("pushSubscriptions", id);
    }
    for (const id of args.failed) {
      const row = await ctx.db.get("pushSubscriptions", id);
      if (row === null) continue;
      const failures = (row.failures ?? 0) + 1;
      if (failures >= MAX_FAILURES) await ctx.db.delete("pushSubscriptions", id);
      else await ctx.db.patch("pushSubscriptions", id, { failures });
    }
    for (const id of args.ok) {
      if ((await ctx.db.get("pushSubscriptions", id)) !== null) {
        await ctx.db.patch("pushSubscriptions", id, { lastUsedAt: now, failures: 0 });
      }
    }
    for (const id of args.notificationIds) {
      const row = await ctx.db.get("notifications", id);
      if (row !== null && row.pushedAt === undefined) await ctx.db.patch("notifications", id, { pushedAt: now });
    }
    return null;
  },
});
