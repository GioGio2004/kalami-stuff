import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { fanOutBroadcast } from "./model/broadcasts";

// The notification center's sending, batch by batch. The admin-facing
// functions (preview, send, history) live in platform.ts.

/** One batch of one part of a broadcast's audience; schedules what comes next itself. */
export const fanOut = internalMutation({
  args: { broadcastId: v.id("broadcasts"), phase: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await fanOutBroadcast(ctx, args);
    return null;
  },
});
