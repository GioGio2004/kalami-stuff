import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** How close to a deadline a deploy is refused. */
const GUARD_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * For scripts/predeploy.mjs: whether students are in the middle of timed work
 * right now, or work closes within the next two hours with attempts still
 * open. A deploy restarts the apps' bundles; it must not land in an exam.
 */
export const deployGuard = internalQuery({
  args: {},
  returns: v.object({ busy: v.boolean(), reason: v.string() }),
  handler: async (ctx) => {
    const now = Date.now();
    const timed = await ctx.db
      .query("attempts")
      .withIndex("by_status_and_deadlineAt", (q) =>
        q.eq("status", "in_progress").gte("deadlineAt", now - GUARD_WINDOW_MS).lte("deadlineAt", now + GUARD_WINDOW_MS),
      )
      .first();
    if (timed !== null) {
      return { busy: true, reason: "a timed attempt is in progress or ends within two hours" };
    }
    const closing = await ctx.db
      .query("assessments")
      .withIndex("by_status_and_closesAt", (q) =>
        q.eq("status", "published").gte("settings.closesAt", now - GUARD_WINDOW_MS).lte("settings.closesAt", now + GUARD_WINDOW_MS),
      )
      .take(50);
    for (const assessment of closing) {
      const open = await ctx.db
        .query("attempts")
        .withIndex("by_assessmentId_and_status", (q) => q.eq("assessmentId", assessment._id).eq("status", "in_progress"))
        .first();
      if (open !== null) {
        return { busy: true, reason: `“${assessment.title}” closes within two hours and students are still working on it` };
      }
    }
    return { busy: false, reason: "no exam is running or about to close" };
  },
});
