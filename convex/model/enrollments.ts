import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// A student reaches a course through its join code, through groups the course
// is shared with, or both. Each way in is recorded on the one enrollment row,
// so leaving a group keeps the access the code gave, and the row goes away
// only when the last way in does. Everything else (course lists, notifications,
// the student count) reads the row and doesn't care how it came about.

export async function enrollmentOf(ctx: QueryCtx, courseId: Id<"courses">, userId: Id<"users">) {
  return await ctx.db
    .query("enrollments")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", courseId).eq("userId", userId))
    .unique();
}

/** Rows from before groups existed have neither field; they all came from a join code. */
export function cameByCode(row: Doc<"enrollments">): boolean {
  return row.viaCode ?? row.groupIds === undefined;
}

/**
 * The student typed the course's code. A student the lecturer removed stays
 * removed (the caller tells them so).
 */
export async function enrollByCode(
  ctx: MutationCtx,
  courseId: Id<"courses">,
  userId: Id<"users">,
): Promise<"enrolled" | "removed"> {
  const row = await enrollmentOf(ctx, courseId, userId);
  if (row === null) {
    await ctx.db.insert("enrollments", {
      courseId,
      userId,
      status: "active",
      enrolledAt: Date.now(),
      viaCode: true,
      groupIds: [],
    });
    return "enrolled";
  }
  if (row.status === "removed") {
    return "removed";
  }
  if (row.viaCode !== true) {
    await ctx.db.patch("enrollments", row._id, { viaCode: true, groupIds: row.groupIds ?? [] });
  }
  return "enrolled";
}

/**
 * The course is shared with a group the student is in. This is the lecturer
 * acting (they invited the student or shared the course), so it also brings
 * back a student who was removed.
 */
export async function enrollThroughGroup(
  ctx: MutationCtx,
  courseId: Id<"courses">,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const row = await enrollmentOf(ctx, courseId, userId);
  if (row === null) {
    await ctx.db.insert("enrollments", {
      courseId,
      userId,
      status: "active",
      enrolledAt: Date.now(),
      viaCode: false,
      groupIds: [groupId],
    });
    return;
  }
  const groupIds = row.groupIds ?? [];
  if (row.status === "active" && groupIds.includes(groupId)) {
    return;
  }
  await ctx.db.patch("enrollments", row._id, {
    status: "active",
    viaCode: row.status === "removed" ? false : cameByCode(row),
    groupIds: groupIds.includes(groupId) ? groupIds : [...groupIds, groupId],
  });
}

/** The group no longer gives this student the course; the row goes once nothing else does. */
export async function unenrollFromGroup(
  ctx: MutationCtx,
  courseId: Id<"courses">,
  userId: Id<"users">,
  groupId: Id<"groups">,
): Promise<void> {
  const row = await enrollmentOf(ctx, courseId, userId);
  if (row === null || !(row.groupIds ?? []).includes(groupId)) {
    return;
  }
  const groupIds = (row.groupIds ?? []).filter((id) => id !== groupId);
  if (row.status === "active" && groupIds.length === 0 && !cameByCode(row)) {
    await ctx.db.delete("enrollments", row._id);
    return;
  }
  await ctx.db.patch("enrollments", row._id, { groupIds, viaCode: cameByCode(row) });
}
