import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Picks what Kalami stores from Clerk's UserJSON. Returns null without a usable email. */
function parseClerkUser(data: Record<string, unknown>) {
  if (typeof data.id !== "string") {
    return null;
  }
  const addresses = (Array.isArray(data.email_addresses) ? data.email_addresses : []).filter(isRecord);
  const primary =
    addresses.find((address) => address.id === data.primary_email_address_id) ??
    // No primary linked (Clerk's dashboard test events, for one): only a verified address will do.
    addresses.find((address) => isRecord(address.verification) && address.verification.status === "verified");
  const email = optionalString(primary?.email_address);
  if (email === undefined) {
    return null;
  }
  return {
    clerkUserId: data.id,
    email,
    firstName: optionalString(data.first_name),
    lastName: optionalString(data.last_name),
    avatarUrl: optionalString(data.image_url),
  };
}

export default http;
