import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * One-time data moves between schema versions. Each is idempotent and runs in
 * batches that reschedule themselves, so running it again (or from the cron
 * in crons.ts, until it's removed) is harmless.
 */

const BATCH = 50;

/**
 * Before weeks, each week of materials was a `materials` row: one Drive folder
 * or one link. Each row becomes a week with the same title, order, state and
 * Drive folder (its link, if it had one, becomes the week's first link).
 * The old rows are deleted. Once every deployment reports 0, the `materials`
 * table and this function can go.
 */
export const materialsToWeeks = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("materials").take(BATCH);
    for (const row of rows) {
      const syncing = row.syncing === "folder" ? undefined : row.syncing;
      await ctx.db.insert("weeks", {
        courseId: row.courseId,
        order: row.order,
        title: row.title,
        description: row.description,
        status: row.status,
        publishedAt: row.publishedAt,
        links: row.source === "link" && row.url ? [{ id: `m${row._id.slice(-10)}`, title: row.title, url: row.url }] : [],
        folderId: row.folderId,
        permissionId: row.permissionId,
        // A folder still being created is retried by the lecturer; sharing jobs carry on by themselves.
        syncing,
        syncingSince: syncing ? row.syncingSince : undefined,
        driveError: row.source === "drive" && row.folderId === undefined ? "Create this week's Drive folder again." : row.driveError,
        createdBy: row.createdBy,
        createdVia: row.createdVia,
        updatedAt: row.updatedAt,
      });
      await ctx.db.delete("materials", row._id);
    }
    if (rows.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.migrations.materialsToWeeks, {});
    }
    return rows.length;
  },
});
