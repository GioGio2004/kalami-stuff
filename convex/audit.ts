import { v } from "convex/values";
import { query } from "./_generated/server";
import { courseAccess, requireStaffActor } from "./lib/access";
import { auditEntryValidator, toAuditEntries } from "./model/audit";

/** What the signed-in person, or their agent, did recently. Newest first. */
export const recentForMe = query({
  args: {},
  returns: v.array(auditEntryValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_actorId", (q) => q.eq("actorId", actor.user._id))
      .order("desc")
      .take(20);
    return await toAuditEntries(ctx, actor, rows);
  },
});

/** A course's history, for anyone who can open the course. Newest first. */
export const recentForCourse = query({
  args: { courseId: v.id("courses") },
  returns: v.array(auditEntryValidator),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await courseAccess(ctx, actor, args.courseId);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_courseId", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .take(30);
    return await toAuditEntries(ctx, actor, rows);
  },
});
