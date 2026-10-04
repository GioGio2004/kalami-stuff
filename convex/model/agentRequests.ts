import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/access";

/**
 * Creating agent tools accept a request id, so a retried call (after a
 * timeout) returns what the first one made instead of making it twice.
 */
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_ID = 100;

/** What an earlier call with this request id returned, within the last day. */
export async function remembered(ctx: QueryCtx, actor: Actor, requestId: string | undefined) {
  if (requestId === undefined) return null;
  const row = await ctx.db
    .query("agentRequests")
    .withIndex("by_actorId_and_requestId", (q) => q.eq("actorId", actor.user._id).eq("requestId", requestId))
    .first();
  return row !== null && row.at >= Date.now() - REQUEST_WINDOW_MS ? row.result : null;
}

export async function remember(ctx: MutationCtx, actor: Actor, requestId: string | undefined, result: string | string[]) {
  if (requestId === undefined || requestId.length > MAX_REQUEST_ID) return;
  await ctx.db.insert("agentRequests", { actorId: actor.user._id, requestId, result, at: Date.now() });
}
