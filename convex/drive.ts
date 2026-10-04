import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { getMemberships, isStaffRole, userByClerkUserId } from "./lib/auth";
import {
  DriveError,
  driveConfigured,
  ensureFolder,
  googleAccessToken,
  requireFolder,
  shareByLink,
  unshareByLink,
} from "./lib/google";
import { driveOf } from "./model/materials";

/**
 * The Google Drive jobs model/materials.ts schedules. Each reads the week,
 * gets a fresh token for the course's Drive owner, calls Google, and reports
 * back. Google and the database can't change in one transaction, so every
 * step is safe to repeat: folders are found by their Kalami tag before one is
 * created, and unsharing something already unshared counts as done. Busy or
 * flaky Google gets a few retries with growing pauses; anything else stops
 * with a message the lecturer can act on.
 */

const MAX_ATTEMPTS = 4;

function retryDelay(attempt: number): number {
  return 5_000 * 2 ** attempt + Math.floor(Math.random() * 2_000);
}

function messageOf(error: unknown): string {
  return error instanceof DriveError ? error.message : "Something went wrong with Google Drive. Try again.";
}

function shouldRetry(error: unknown, attempt: number): boolean {
  return error instanceof DriveError && error.retry && attempt + 1 < MAX_ATTEMPTS;
}

// --- What the jobs read and write ---------------------------------------------------------

export const job = internalQuery({
  args: { materialId: v.id("materials") },
  returns: v.union(
    v.null(),
    v.object({
      courseId: v.id("courses"),
      courseTitle: v.string(),
      title: v.string(),
      status: v.union(v.literal("draft"), v.literal("published")),
      folderId: v.optional(v.string()),
      permissionId: v.optional(v.string()),
      rootFolderId: v.optional(v.string()),
      ownerClerkId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("materials", args.materialId);
    const course = row === null ? null : await ctx.db.get("courses", row.courseId);
    if (row === null || course === null) {
      return null;
    }
    const drive = await driveOf(ctx, row.courseId);
    const owner = drive === null ? null : await ctx.db.get("users", drive.ownerId);
    return {
      courseId: row.courseId,
      courseTitle: course.title,
      title: row.title,
      status: row.status,
      folderId: row.folderId,
      permissionId: row.permissionId,
      rootFolderId: drive?.folderId,
      ownerClerkId: owner?.deletedAt === undefined ? owner?.clerkUserId : undefined,
    };
  },
});

export const saveRootFolder = internalMutation({
  args: { courseId: v.id("courses"), folderId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const drive = await driveOf(ctx, args.courseId);
    if (drive !== null && drive.folderId === undefined) {
      await ctx.db.patch("courseDrive", drive._id, { folderId: args.folderId, error: undefined, updatedAt: Date.now() });
    }
    return null;
  },
});

/** Records a job's outcome. `clearSyncing` ends the "working on it" state. */
export const report = internalMutation({
  args: {
    materialId: v.id("materials"),
    folderId: v.optional(v.string()),
    permissionId: v.optional(v.union(v.string(), v.null())),
    driveError: v.optional(v.string()),
    clearSyncing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("materials", args.materialId);
    if (row === null) {
      return null;
    }
    await ctx.db.patch("materials", row._id, {
      ...(args.folderId !== undefined ? { folderId: args.folderId } : {}),
      ...(args.permissionId !== undefined ? { permissionId: args.permissionId ?? undefined } : {}),
      driveError: args.driveError,
      ...(args.clearSyncing ? { syncing: undefined, syncingSince: undefined } : { syncingSince: Date.now() }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// --- The jobs ---------------------------------------------------------------------------

type Job = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

async function loadJob(ctx: ActionCtx, materialId: Id<"materials">) {
  return await ctx.runQuery(internal.drive.job, { materialId });
}

async function tokenFor(job: Job): Promise<string> {
  if (job.ownerClerkId === undefined) {
    throw new DriveError("The person whose Google Drive holds this course's materials no longer has an account.");
  }
  return await googleAccessToken(job.ownerClerkId);
}

/** Runs `work`; on failure reports it, or schedules another attempt when Google was just busy. */
async function run(
  ctx: ActionCtx,
  materialId: Id<"materials">,
  attempt: number,
  again: (delay: number) => Promise<unknown>,
  work: (job: Job) => Promise<void>,
) {
  const job = await loadJob(ctx, materialId);
  if (job === null) {
    return;
  }
  try {
    await work(job);
  } catch (error) {
    if (!(error instanceof DriveError)) {
      console.error("Drive job failed", materialId, error);
    }
    if (shouldRetry(error, attempt)) {
      await ctx.runMutation(internal.drive.report, { materialId, driveError: messageOf(error), clearSyncing: false });
      await again(retryDelay(attempt));
      return;
    }
    await ctx.runMutation(internal.drive.report, { materialId, driveError: messageOf(error), clearSyncing: true });
  }
}

/** Creates the week's folder inside the course folder (and the course folder, the first time). */
export const createWeekFolder = internalAction({
  args: { materialId: v.id("materials"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { materialId, attempt }) => {
    const again = (delay: number) =>
      ctx.scheduler.runAfter(delay, internal.drive.createWeekFolder, { materialId, attempt: attempt + 1 });
    await run(ctx, materialId, attempt, again, async (job) => {
      if (job.folderId !== undefined) {
        await ctx.runMutation(internal.drive.report, { materialId, clearSyncing: true });
        return;
      }
      const token = await tokenFor(job);
      let rootFolderId = job.rootFolderId;
      if (rootFolderId === undefined) {
        rootFolderId = await ensureFolder(token, `course-${job.courseId}`, `Kalami · ${job.courseTitle}`);
        await ctx.runMutation(internal.drive.saveRootFolder, { courseId: job.courseId, folderId: rootFolderId });
        // Two weeks created at once can race to make the course folder; the tag
        // search makes the loser find the winner's folder, and the first save wins.
        rootFolderId = (await loadJob(ctx, materialId))?.rootFolderId ?? rootFolderId;
      }
      const folderId = await ensureFolder(token, `week-${materialId}`, job.title, rootFolderId);
      await ctx.runMutation(internal.drive.report, { materialId, folderId, clearSyncing: true });
    });
    return null;
  },
});

/** "Anyone with the link can view" on the week's folder, so students can open it. */
export const shareWeek = internalAction({
  args: { materialId: v.id("materials"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { materialId, attempt }) => {
    const again = (delay: number) =>
      ctx.scheduler.runAfter(delay, internal.drive.shareWeek, { materialId, attempt: attempt + 1 });
    await run(ctx, materialId, attempt, again, async (job) => {
      // Unpublished while waiting, or already shared: nothing to do.
      if (job.status !== "published" || job.permissionId !== undefined || job.folderId === undefined) {
        await ctx.runMutation(internal.drive.report, { materialId, clearSyncing: true });
        return;
      }
      const token = await tokenFor(job);
      await requireFolder(token, job.folderId);
      const permissionId = await shareByLink(token, job.folderId);
      await ctx.runMutation(internal.drive.report, { materialId, permissionId, clearSyncing: true });
    });
    return null;
  },
});

/** Takes the link sharing off the week's folder. */
export const unshareWeek = internalAction({
  args: { materialId: v.id("materials"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { materialId, attempt }) => {
    const again = (delay: number) =>
      ctx.scheduler.runAfter(delay, internal.drive.unshareWeek, { materialId, attempt: attempt + 1 });
    await run(ctx, materialId, attempt, again, async (job) => {
      if (job.permissionId === undefined || job.folderId === undefined) {
        await ctx.runMutation(internal.drive.report, { materialId, clearSyncing: true });
        return;
      }
      const token = await tokenFor(job);
      await unshareByLink(token, job.folderId, job.permissionId);
      await ctx.runMutation(internal.drive.report, { materialId, permissionId: null, clearSyncing: true });
    });
    return null;
  },
});

// --- Connection status for the staff app ----------------------------------------------------

export const isStaff = internalQuery({
  args: { clerkUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await userByClerkUserId(ctx, args.clerkUserId);
    if (user === null || user.deletedAt !== undefined) {
      return false;
    }
    return (await getMemberships(ctx, user._id)).some((m) => isStaffRole(m.role));
  },
});

/**
 * Whether the signed-in lecturer's Google account lets Kalami create folders.
 * Asks Clerk (which asks Google) rather than trusting the browser.
 */
export const connection = action({
  args: {},
  returns: v.object({
    available: v.boolean(),
    connected: v.boolean(),
    problem: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null || !(await ctx.runQuery(internal.drive.isStaff, { clerkUserId: identity.subject }))) {
      return { available: driveConfigured(), connected: false, problem: "Sign in as staff." };
    }
    if (!driveConfigured()) {
      return { available: false, connected: false };
    }
    try {
      await googleAccessToken(identity.subject);
      return { available: true, connected: true };
    } catch (error) {
      return { available: true, connected: false, problem: messageOf(error) };
    }
  },
});

