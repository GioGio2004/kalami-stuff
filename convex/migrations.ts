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

/**
 * Code steps aren't tracked any more (2026-11-05): saves stopped recording the
 * step a student reached. Clears the old `progress` on responses, then
 * `stepsDone` on attempts, a page at a time; each page schedules the next.
 * Run once per deployment (`npx convex run migrations:clearStepProgress`, add
 * `--prod` for production). Once every deployment has run it, both fields can
 * leave the schema and this function can go.
 */
export const clearStepProgress = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("responses"), v.literal("attempts"))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ table: v.string(), cleared: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const table = args.table ?? "responses";
    const paginationOpts = { cursor: args.cursor ?? null, numItems: BATCH };
    let cleared = 0;
    let page;
    if (table === "responses") {
      page = await ctx.db.query("responses").paginate(paginationOpts);
      for (const response of page.page) {
        if (response.progress === undefined) continue;
        await ctx.db.patch("responses", response._id, { progress: undefined });
        cleared += 1;
      }
    } else {
      page = await ctx.db.query("attempts").paginate(paginationOpts);
      for (const attempt of page.page) {
        if (attempt.stepsDone === undefined) continue;
        await ctx.db.patch("attempts", attempt._id, { stepsDone: undefined });
        cleared += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.clearStepProgress, { table, cursor: page.continueCursor });
    } else if (table === "responses") {
      await ctx.scheduler.runAfter(0, internal.migrations.clearStepProgress, { table: "attempts", cursor: null });
    }
    return { table, cleared, done: page.isDone && table === "attempts" };
  },
});
