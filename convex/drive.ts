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
import { driveOf, STALE_SYNC_MS } from "./model/weeks";

/**
 * The Google Drive jobs model/weeks.ts schedules. Each reads the week,
 * gets a fresh token for the course's Drive owner, calls Google, and reports
 * back. Google and the database can't change in one transaction, so every
 * step is safe to repeat: folders are found by their Kalami tag before one is
 * created, creating the course folder is claimed first so two jobs don't both
 * make one, and unsharing something already unshared counts as done. A late
 * result from a job that was overtaken is ignored, except a share, which is
 * always recorded so it can be taken back. Busy or flaky Google gets a few
 * retries with growing pauses; anything else stops with a message the
 * lecturer can act on.
 */

const MAX_ATTEMPTS = 4;
/** How long a job waits before looking again while another one creates the course folder. */
const ROOT_WAIT_MS = 3_000;

const jobValidator = v.union(v.literal("folder"), v.literal("share"), v.literal("unshare"));
type Job = "folder" | "share" | "unshare";

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
  args: { weekId: v.id("weeks") },
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
    const row = await ctx.db.get("weeks", args.weekId);
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

/**
 * Who makes the course folder: the first job to ask. Others wait and look
 * again; a claim that never finished is taken over once it's stale.
 */
export const claimRootFolder = internalMutation({
  args: { courseId: v.id("courses") },
  returns: v.union(
    v.object({ state: v.literal("ready"), folderId: v.string() }),
    v.object({ state: v.literal("claimed") }),
    v.object({ state: v.literal("busy") }),
    v.object({ state: v.literal("gone") }),
  ),
  handler: async (ctx, args) => {
    const drive = await driveOf(ctx, args.courseId);
    if (drive === null) {
      return { state: "gone" as const };
    }
    if (drive.folderId !== undefined) {
      return { state: "ready" as const, folderId: drive.folderId };
    }
    const now = Date.now();
    if (drive.creatingSince !== undefined && now - drive.creatingSince < STALE_SYNC_MS) {
      return { state: "busy" as const };
    }
    await ctx.db.patch("courseDrive", drive._id, { creatingSince: now, updatedAt: now });
    return { state: "claimed" as const };
  },
});

/** Saves the course folder (or, without one, gives up the claim so another job can try). */
export const finishRootFolder = internalMutation({
  args: { courseId: v.id("courses"), folderId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const drive = await driveOf(ctx, args.courseId);
    if (drive !== null) {
      await ctx.db.patch("courseDrive", drive._id, {
        folderId: drive.folderId ?? args.folderId,
        creatingSince: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** The course folder was deleted in Drive: forget it, so the next job makes a new one. */
export const forgetRootFolder = internalMutation({
  args: { courseId: v.id("courses"), folderId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const drive = await driveOf(ctx, args.courseId);
    if (drive !== null && drive.folderId === args.folderId) {
      await ctx.db.patch("courseDrive", drive._id, { folderId: undefined, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Records a job's outcome, if that job is still the one the week is waiting
 * for. `clearSyncing` ends the "working on it" state; without it the job is
 * retrying and only its heartbeat is refreshed.
 */
export const report = internalMutation({
  args: {
    weekId: v.id("weeks"),
    job: jobValidator,
    folderId: v.optional(v.string()),
    permissionId: v.optional(v.union(v.string(), v.null())),
    driveError: v.optional(v.string()),
    clearSyncing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("weeks", args.weekId);
    if (row === null) {
      return null;
    }
    const now = Date.now();
    // A share that went through is always recorded: if the week was hidden in
    // the meantime, the sharing is taken straight back off.
    if (args.job === "share" && typeof args.permissionId === "string") {
      const hideAgain = row.status === "draft";
      await ctx.db.patch("weeks", row._id, {
        permissionId: args.permissionId,
        driveError: undefined,
        ...(hideAgain
          ? { syncing: "unshare" as const, syncingSince: now }
          : row.syncing === "share"
            ? { syncing: undefined, syncingSince: undefined }
            : {}),
        updatedAt: now,
      });
      if (hideAgain) {
        await ctx.scheduler.runAfter(0, internal.drive.unshareWeek, { weekId: row._id, attempt: 0 });
      }
      return null;
    }
    if (row.syncing !== args.job) {
      return null;
    }
    await ctx.db.patch("weeks", row._id, {
      ...(args.folderId !== undefined ? { folderId: args.folderId } : {}),
      ...(args.permissionId !== undefined ? { permissionId: args.permissionId ?? undefined } : {}),
      driveError: args.driveError,
      ...(args.clearSyncing ? { syncing: undefined, syncingSince: undefined } : { syncingSince: now }),
      updatedAt: now,
    });
    return null;
  },
});

// --- The jobs ---------------------------------------------------------------------------

type JobRow = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

async function loadJob(ctx: ActionCtx, weekId: Id<"weeks">) {
  return await ctx.runQuery(internal.drive.job, { weekId });
}

async function tokenFor(row: JobRow): Promise<string> {
  if (row.ownerClerkId === undefined) {
    throw new DriveError(
      "The person whose Google Drive holds this course's materials no longer has an account. Use “Move to my Drive” on the course page.",
    );
  }
  return await googleAccessToken(row.ownerClerkId);
}

/** Runs `work`; on failure reports it, or schedules another attempt when Google was just busy. */
async function run(
  ctx: ActionCtx,
  weekId: Id<"weeks">,
  jobName: Job,
  attempt: number,
  again: (delay: number) => Promise<unknown>,
  work: (row: JobRow) => Promise<void>,
) {
  const row = await loadJob(ctx, weekId);
  if (row === null) {
    return;
  }
  try {
    await work(row);
  } catch (error) {
    if (!(error instanceof DriveError)) {
      console.error("Drive job failed", weekId, error);
    }
    if (shouldRetry(error, attempt)) {
      await ctx.runMutation(internal.drive.report, { weekId, job: jobName, driveError: messageOf(error), clearSyncing: false });
      await again(retryDelay(attempt));
      return;
    }
    await ctx.runMutation(internal.drive.report, { weekId, job: jobName, driveError: messageOf(error), clearSyncing: true });
  }
}

/** Creates the week's folder inside the course folder (and the course folder, the first time). */
export const createWeekFolder = internalAction({
  args: { weekId: v.id("weeks"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { weekId, attempt }) => {
    const again = (delay: number, nextAttempt = attempt + 1) =>
      ctx.scheduler.runAfter(delay, internal.drive.createWeekFolder, { weekId, attempt: nextAttempt });
    await run(ctx, weekId, "folder", attempt, again, async (row) => {
      if (row.folderId !== undefined) {
        await ctx.runMutation(internal.drive.report, { weekId, job: "folder", clearSyncing: true });
        return;
      }
      const token = await tokenFor(row);
      let rootFolderId = row.rootFolderId;
      if (rootFolderId !== undefined) {
        try {
          await requireFolder(token, rootFolderId);
        } catch (error) {
          if (!(error instanceof DriveError && error.missing)) throw error;
          // The course folder was deleted in Drive: start a fresh one.
          await ctx.runMutation(internal.drive.forgetRootFolder, { courseId: row.courseId, folderId: rootFolderId });
          rootFolderId = undefined;
        }
      }
      if (rootFolderId === undefined) {
        const claim = await ctx.runMutation(internal.drive.claimRootFolder, { courseId: row.courseId });
        if (claim.state === "gone") {
          throw new DriveError("This course's Google Drive was reset. Create the week again.");
        }
        if (claim.state === "busy") {
          // Another week is creating the course folder right now; look again shortly.
          await ctx.runMutation(internal.drive.report, { weekId, job: "folder", clearSyncing: false });
          await again(ROOT_WAIT_MS, attempt);
          return;
        }
        if (claim.state === "ready") {
          rootFolderId = claim.folderId;
        } else {
          try {
            rootFolderId = await ensureFolder(token, `course-${row.courseId}`, `Kalami · ${row.courseTitle}`);
          } finally {
            await ctx.runMutation(internal.drive.finishRootFolder, { courseId: row.courseId, folderId: rootFolderId });
          }
        }
      }
      const folderId = await ensureFolder(token, `week-${weekId}`, row.title, rootFolderId);
      await ctx.runMutation(internal.drive.report, { weekId, job: "folder", folderId, clearSyncing: true });
    });
    return null;
  },
});

/** "Anyone with the link can view" on the week's folder, so students can open it. */
export const shareWeek = internalAction({
  args: { weekId: v.id("weeks"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { weekId, attempt }) => {
    const again = (delay: number) =>
      ctx.scheduler.runAfter(delay, internal.drive.shareWeek, { weekId, attempt: attempt + 1 });
    await run(ctx, weekId, "share", attempt, again, async (row) => {
      // Unpublished while waiting, or already shared: nothing to do.
      if (row.status !== "published" || row.permissionId !== undefined || row.folderId === undefined) {
        await ctx.runMutation(internal.drive.report, { weekId, job: "share", clearSyncing: true });
        return;
      }
      const token = await tokenFor(row);
      await requireFolder(token, row.folderId);
      const permissionId = await shareByLink(token, row.folderId);
      await ctx.runMutation(internal.drive.report, { weekId, job: "share", permissionId, clearSyncing: true });
    });
    return null;
  },
});

/** Takes the link sharing off the week's folder. */
export const unshareWeek = internalAction({
  args: { weekId: v.id("weeks"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { weekId, attempt }) => {
    const again = (delay: number) =>
      ctx.scheduler.runAfter(delay, internal.drive.unshareWeek, { weekId, attempt: attempt + 1 });
    await run(ctx, weekId, "unshare", attempt, again, async (row) => {
      if (row.permissionId === undefined || row.folderId === undefined) {
        await ctx.runMutation(internal.drive.report, { weekId, job: "unshare", clearSyncing: true });
        return;
      }
      const token = await tokenFor(row);
      await unshareByLink(token, row.folderId, row.permissionId);
      await ctx.runMutation(internal.drive.report, { weekId, job: "unshare", permissionId: null, clearSyncing: true });
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
