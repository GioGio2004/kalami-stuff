import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Rows one purge run deletes before handing over to the next run. */
export const PURGE_BATCH = 1000;

type Budget = { left: number };

/**
 * Deletes the rows `load` finds, at most what's left of the budget. True when
 * nothing was left over (fewer rows came back than were asked for).
 */
async function drain<Row>(
  budget: Budget,
  load: (limit: number) => Promise<Row[]>,
  remove: (row: Row) => Promise<void>,
): Promise<boolean> {
  if (budget.left <= 0) {
    return false;
  }
  const rows = await load(budget.left);
  for (const row of rows) {
    await remove(row);
  }
  budget.left -= rows.length;
  return budget.left > 0;
}

/** An assessment's questions, keys, notification runs and every attempt with its answers. */
async function purgeAssessment(ctx: MutationCtx, assessmentId: Id<"assessments">, budget: Budget) {
  for (;;) {
    const attempt = await ctx.db
      .query("attempts")
      .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
      .first();
    if (attempt === null) {
      break;
    }
    const answersGone =
      (await drain(
        budget,
        (n) =>
          ctx.db
            .query("responses")
            .withIndex("by_attemptId_and_questionId", (q) => q.eq("attemptId", attempt._id))
            .take(n),
        (row) => ctx.db.delete("responses", row._id),
      )) &&
      (await drain(
        budget,
        (n) =>
          ctx.db
            .query("codeComments")
            .withIndex("by_attemptId", (q) => q.eq("attemptId", attempt._id))
            .take(n),
        (row) => ctx.db.delete("codeComments", row._id),
      ));
    if (!answersGone) {
      return false;
    }
    await ctx.db.delete("attempts", attempt._id);
    budget.left--;
  }
  return (
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("answerKeys")
          .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
          .take(n),
      (row) => ctx.db.delete("answerKeys", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("questions")
          .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
          .take(n),
      (row) => ctx.db.delete("questions", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("notificationRuns")
          .withIndex("by_assessmentId_and_kind", (q) => q.eq("assessmentId", assessmentId))
          .take(n),
      (row) => ctx.db.delete("notificationRuns", row._id),
    ))
  );
}

/** The course's crosswords, each once the students' progress in it is gone. */
async function purgeCrosswords(ctx: MutationCtx, courseId: Id<"courses">, budget: Budget): Promise<boolean> {
  for (;;) {
    const crossword = await ctx.db
      .query("crosswords")
      .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
      .first();
    if (crossword === null) {
      return true;
    }
    const progressGone = await drain(
      budget,
      (n) =>
        ctx.db
          .query("crosswordProgress")
          .withIndex("by_crosswordId_and_userId", (q) => q.eq("crosswordId", crossword._id))
          .take(n),
      (row) => ctx.db.delete("crosswordProgress", row._id),
    );
    if (!progressGone) {
      return false;
    }
    await ctx.db.delete("crosswords", crossword._id);
    budget.left--;
  }
}

/**
 * One run of removing what belonged to a deleted course: its assessments
 * (with students' attempts, answers and grades), weeks, lessons, legacy
 * materials, crosswords (with students' progress), notifications, group shares, Drive link, staff seats,
 * enrollments and pictures (the ImageKit files go too, unless another course
 * shows the same file). True when nothing is left; otherwise run it again.
 *
 * Kept on purpose: conversations (they're between people; they lose the
 * course title), the audit log, and the files in the lecturer's Google Drive.
 */
export async function purgeCourseStep(ctx: MutationCtx, courseId: Id<"courses">): Promise<boolean> {
  const budget: Budget = { left: PURGE_BATCH };
  for (;;) {
    const assessment = await ctx.db
      .query("assessments")
      .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
      .first();
    if (assessment === null) {
      break;
    }
    if (!(await purgeAssessment(ctx, assessment._id, budget))) {
      return false;
    }
    await ctx.db.delete("assessments", assessment._id);
    budget.left--;
  }
  const unused: string[] = [];
  const picturesGone = await drain(
    budget,
    (n) =>
      ctx.db
        .query("media")
        .withIndex("by_courseId_and_url", (q) => q.eq("courseId", courseId))
        .take(n),
    async (row) => {
      await ctx.db.delete("media", row._id);
      const shared = await ctx.db
        .query("media")
        .withIndex("by_fileId", (q) => q.eq("fileId", row.fileId))
        .first();
      if (shared === null && !unused.includes(row.fileId)) unused.push(row.fileId);
    },
  );
  if (unused.length > 0) {
    await ctx.scheduler.runAfter(0, internal.mediaActions.deleteFiles, { fileIds: unused });
  }
  if (!picturesGone) {
    return false;
  }
  return (
    (await drain(
      budget,
      (n) => ctx.db.query("readingDocuments").withIndex("by_courseId", (q) => q.eq("courseId", courseId)).take(n),
      (row) => ctx.db.delete("readingDocuments", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("lessons")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("lessons", row._id),
    )) &&
    (await purgeCrosswords(ctx, courseId, budget)) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("presentations")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("presentations", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("weeks")
          .withIndex("by_courseId_and_order", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("weeks", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("materials")
          .withIndex("by_courseId_and_order", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("materials", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("notifications")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("notifications", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("courseGroups")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("courseGroups", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("courseDrive")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("courseDrive", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("courseStaff")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("courseStaff", row._id),
    )) &&
    (await drain(
      budget,
      (n) =>
        ctx.db
          .query("enrollments")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .take(n),
      (row) => ctx.db.delete("enrollments", row._id),
    ))
  );
}
