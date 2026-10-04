import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { resendClient } from "./email";
import { renderUnsubscribePage } from "./lib/email/templates";

const http = httpRouter();

/**
 * Clerk → Convex user sync. In the Clerk dashboard, add an endpoint at
 *   https://<deployment>.convex.site/clerk-users-webhook
 * subscribed to user.created, user.updated and user.deleted, then store its signing
 * secret on the deployment:  npx convex env set CLERK_WEBHOOK_SECRET whsec_...
 */
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("CLERK_WEBHOOK_SECRET is not set; rejecting Clerk webhook");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const payload = await request.text();
    try {
      // svix 2.x verify() returns nothing and throws if the signature, timestamp
      // (5-minute tolerance, so replays fail) or headers are wrong.
      new Webhook(secret).verify(payload, {
        "svix-id": request.headers.get("svix-id") ?? "",
        "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
        "svix-signature": request.headers.get("svix-signature") ?? "",
      });
    } catch {
      return new Response("Invalid signature", { status: 400 });
    }

    const event: unknown = JSON.parse(payload);
    if (!isRecord(event) || typeof event.type !== "string" || !isRecord(event.data)) {
      return new Response("Unexpected payload", { status: 400 });
    }

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const user = parseClerkUser(event.data);
        if (user === null) {
          // Kalami requires a verified email at sign-up, so this should not happen;
          // ack it so Clerk doesn't retry a payload we will never accept.
          const addresses = Array.isArray(event.data.email_addresses) ? event.data.email_addresses.length : 0;
          console.warn(`Ignoring ${event.type} for ${String(event.data.id)}: no usable email (${addresses} addresses)`);
          break;
        }
        await ctx.runMutation(internal.users.upsertFromClerk, user);
        break;
      }
      case "user.deleted": {
        if (typeof event.data.id === "string") {
          await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId: event.data.id });
        }
        break;
      }
      default:
        // Other events are acknowledged so Clerk stops retrying them.
        break;
    }
    return new Response(null, { status: 200 });
  }),
});

/**
 * Resend → Convex delivery events (delivered, bounced, complained…). In the
 * Resend dashboard, add a webhook at
 *   https://<deployment>.convex.site/resend-webhook
 * for every email.* event, and store its secret:  npx convex env set RESEND_WEBHOOK_SECRET whsec_...
 * The component checks the signature; email.ts reacts to bounces and complaints.
 */
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => await resendClient().handleResendEventWebhook(ctx, request)),
});

/**
 * The unsubscribe link in every notification email. GET shows a page with one
 * button; POST (the button, or a mail client's one-click unsubscribe per RFC
 * 8058) switches that person's emails off. The signed token in the link is the
 * only credential, so the page never shows who the person is.
 */
const UNSUBSCRIBE_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

http.route({
  path: "/email/unsubscribe",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("u") && url.searchParams.get("t") ? "ask" : "invalid";
    return new Response(renderUnsubscribePage(state), { status: state === "ask" ? 200 : 404, headers: UNSUBSCRIBE_HEADERS });
  }),
});

http.route({
  path: "/email/unsubscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("u") ?? "";
    const token = url.searchParams.get("t") ?? "";
    const ok =
      userId !== "" && token !== "" && (await ctx.runMutation(internal.notifications.unsubscribe, { userId, token }));
    return new Response(renderUnsubscribePage(ok ? "done" : "invalid"), {
      status: ok ? 200 : 404,
      headers: UNSUBSCRIBE_HEADERS,
    });
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Picks what Kalami stores from Clerk's UserJSON. Returns null without a usable
 * email. `emailVerified` is whether Clerk has verified the chosen address; only
 * a verified one may take over an account from before the Clerk move.
 */
function parseClerkUser(data: Record<string, unknown>) {
  if (typeof data.id !== "string") {
    return null;
  }
  const addresses = (Array.isArray(data.email_addresses) ? data.email_addresses : []).filter(isRecord);
  const verified = (address: Record<string, unknown>) =>
    isRecord(address.verification) && address.verification.status === "verified";
  const primary =
    addresses.find((address) => address.id === data.primary_email_address_id) ??
    // No primary linked (Clerk's dashboard test events, for one): only a verified address will do.
    addresses.find(verified);
  const email = optionalString(primary?.email_address);
  if (email === undefined || primary === undefined) {
    return null;
  }
  return {
    clerkUserId: data.id,
    email,
    emailVerified: verified(primary),
    firstName: optionalString(data.first_name),
    lastName: optionalString(data.last_name),
    avatarUrl: optionalString(data.image_url),
  };
}

export default http;
