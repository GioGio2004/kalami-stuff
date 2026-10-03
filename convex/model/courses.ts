import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  courseAccess,
  creatorUniversityIds,
  requireCourseEditor,
  type Actor,
  type CourseAccess,
} from "../lib/access";
import { isSuperAdmin } from "../lib/auth";
import { appError } from "../lib/errors";
import { optionalText, requireText } from "../lib/input";
import { generateJoinCode } from "../lib/tokens";
import {
  courseStatusValidator,
  localeValidator,
  localizedTextValidator,
  viaValidator,
  type CourseStatus,
  type Locale,
} from "../lib/validators";
import { assessmentValidator, listAssessmentsIn } from "./assessments";
import { logAudit } from "./audit";

export const courseRoleValidator = v.union(
  v.literal("owner"),
  v.literal("assistant"),
  v.literal("admin"),
  v.literal("super_admin"),
);

export const courseCountsValidator = v.object({
  quizzes: v.number(),
  midterms: v.number(),
  finals: v.number(),
  drafts: v.number(),
  published: v.number(),
});

export const courseSummaryValidator = v.object({
  _id: v.id("courses"),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  semester: v.optional(v.string()),
  locale: localeValidator,
  status: courseStatusValidator,
  joinCode: v.string(),
  joinEnabled: v.boolean(),
  universityId: v.id("universities"),
  universityName: localizedTextValidator,
  role: courseRoleValidator,
  canEdit: v.boolean(),
  counts: courseCountsValidator,
  createdVia: viaValidator,
  updatedAt: v.number(),
});

export const courseDetailValidator = v.object({
  ...courseSummaryValidator.fields,
  assessments: v.array(assessmentValidator),
});

export const universityOptionValidator = v.object({
  _id: v.id("universities"),
  name: localizedTextValidator,
});

async function assessmentCounts(ctx: QueryCtx, courseId: Id<"courses">) {
  const rows = await ctx.db
    .query("assessments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(500);
  const counts = { quizzes: 0, midterms: 0, finals: 0, drafts: 0, published: 0 };
  for (const row of rows) {
    if (row.status === "archived") {
      continue;
    }
    if (row.kind === "quiz") counts.quizzes++;
    else if (row.kind === "midterm") counts.midterms++;
    else counts.finals++;
    if (row.status === "draft") counts.drafts++;
    else counts.published++;
  }
  return counts;
}

async function toSummary(
  ctx: QueryCtx,
  access: CourseAccess,
  universities: Map<Id<"universities">, Doc<"universities"> | null>,
) {
  const { course } = access;
  let university = universities.get(course.universityId);
  if (university === undefined) {
    university = await ctx.db.get("universities", course.universityId);
    universities.set(course.universityId, university);
  }
  return {
    _id: course._id,
    _creationTime: course._creationTime,
    title: course.title,
    description: course.description,
    semester: course.semester,
    locale: course.locale,
    status: course.status,
    joinCode: course.joinCode,
    joinEnabled: course.joinEnabled,
    universityId: course.universityId,
    universityName: university?.name ?? { ka: "", en: "" },
    role: access.role,
    canEdit: access.canEdit,
    counts: await assessmentCounts(ctx, course._id),
    createdVia: course.createdVia,
    updatedAt: course.updatedAt,
  };
}

/** Universities the actor may create courses in (all active ones for the super admin). */
export async function creatableUniversities(ctx: QueryCtx, actor: Actor) {
  if (isSuperAdmin(actor.memberships)) {
    const all = await ctx.db
      .query("universities")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(200);
    return all.map((u) => ({ _id: u._id, name: u.name }));
  }
  const ids = [...new Set(creatorUniversityIds(actor))];
  const docs = await Promise.all(ids.map((id) => ctx.db.get("universities", id)));
  return docs.flatMap((u) =>
    u !== null && u.status === "active" ? [{ _id: u._id, name: u.name }] : [],
  );
}

async function pickUniversity(
  ctx: QueryCtx,
  actor: Actor,
  universityId: Id<"universities"> | undefined,
): Promise<Id<"universities">> {
  const allowed = await creatableUniversities(ctx, actor);
  if (universityId !== undefined) {
    if (!allowed.some((u) => u._id === universityId)) {
      throw appError("FORBIDDEN", "You can't create courses in that university.");
    }
    return universityId;
  }
  if (allowed.length === 1) {
    return allowed[0]._id;
  }
  if (allowed.length === 0) {
    throw appError("FORBIDDEN", "Your account isn't attached to an active university.");
  }
  throw appError("INVALID_INPUT", "Choose which university this course belongs to.");
}

async function uniqueJoinCode(ctx: QueryCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const joinCode = generateJoinCode();
    const taken = await ctx.db
      .query("courses")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode))
      .unique();
    if (taken === null) {
      return joinCode;
    }
  }
  throw new Error("Could not find a free join code");
}

export async function createCourse(
  ctx: MutationCtx,
  actor: Actor,
  args: {
    title: string;
    description?: string;
    semester?: string;
    locale?: Locale;
    universityId?: Id<"universities">;
  },
): Promise<Id<"courses">> {
  const title = requireText(args.title, "Title", 120);
  const description = optionalText(args.description, "Description", 2000);
  const semester = optionalText(args.semester, "Semester", 60);
  const universityId = await pickUniversity(ctx, actor, args.universityId);
  const now = Date.now();
  const courseId = await ctx.db.insert("courses", {
    universityId,
    ownerId: actor.user._id,
    title,
    description,
    semester,
    locale: args.locale ?? actor.user.locale,
    status: "draft",
    joinCode: await uniqueJoinCode(ctx),
    joinEnabled: true,
    createdVia: actor.via,
    updatedAt: now,
  });
  await ctx.db.insert("courseStaff", { courseId, userId: actor.user._id, role: "owner" });
  await logAudit(ctx, actor, {
    action: "course.create",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Created course "${title}"`,
  });
  return courseId;
}

/**
 * Every course the actor can open: all of them for the super admin, a
 * university's for its admins, and the ones a lecturer is staff on.
 */
export async function listCoursesFor(ctx: QueryCtx, actor: Actor) {
  const accesses = new Map<Id<"courses">, CourseAccess>();
  const add = (course: Doc<"courses">, access: Omit<CourseAccess, "course">) => {
    if (!accesses.has(course._id)) {
      accesses.set(course._id, { course, ...access });
    }
  };

  if (isSuperAdmin(actor.memberships)) {
    for (const course of await ctx.db.query("courses").order("desc").take(200)) {
      add(course, { canEdit: true, role: "super_admin" });
    }
  }
  for (const membership of actor.memberships) {
    if (membership.role === "uni_admin" && membership.universityId !== undefined) {
      const universityId = membership.universityId;
      const courses = await ctx.db
        .query("courses")
        .withIndex("by_universityId", (q) => q.eq("universityId", universityId))
        .order("desc")
        .take(200);
      for (const course of courses) {
        add(course, { canEdit: true, role: "admin" });
      }
    }
  }
  const staffRows = await ctx.db
    .query("courseStaff")
    .withIndex("by_userId", (q) => q.eq("userId", actor.user._id))
    .take(200);
  for (const row of staffRows) {
    const course = await ctx.db.get("courses", row.courseId);
    if (course !== null) {
      add(course, { canEdit: row.role === "owner", role: row.role });
    }
  }

  const universities = new Map<Id<"universities">, Doc<"universities"> | null>();
  const summaries = [];
  for (const access of accesses.values()) {
    summaries.push(await toSummary(ctx, access, universities));
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function getCourseDetail(ctx: QueryCtx, actor: Actor, courseId: Id<"courses">) {
  const access = await courseAccess(ctx, actor, courseId);
  const summary = await toSummary(ctx, access, new Map());
  return { ...summary, assessments: await listAssessmentsIn(ctx, courseId) };
}

export async function updateCourse(
  ctx: MutationCtx,
  actor: Actor,
  courseId: Id<"courses">,
  patch: {
    title?: string;
    description?: string;
    semester?: string;
    locale?: Locale;
    status?: CourseStatus;
  },
): Promise<void> {
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const changes: Partial<Doc<"courses">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", 120);
  if (patch.description !== undefined) {
    changes.description = optionalText(patch.description, "Description", 2000);
  }
  if (patch.semester !== undefined) changes.semester = optionalText(patch.semester, "Semester", 60);
  if (patch.locale !== undefined) changes.locale = patch.locale;
  if (patch.status !== undefined) changes.status = patch.status;
  await ctx.db.patch("courses", courseId, { ...changes, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "course.update",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Updated ${Object.keys(changes).join(", ") || "nothing"} on "${changes.title ?? course.title}"`,
  });
}

export async function regenerateJoinCode(
  ctx: MutationCtx,
  actor: Actor,
  courseId: Id<"courses">,
): Promise<string> {
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  const joinCode = await uniqueJoinCode(ctx);
  await ctx.db.patch("courses", courseId, { joinCode, joinEnabled: true, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "course.joinCode",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `New join code for "${course.title}"`,
  });
  return joinCode;
}

export async function setJoinEnabled(
  ctx: MutationCtx,
  actor: Actor,
  courseId: Id<"courses">,
  enabled: boolean,
): Promise<void> {
  const { course } = await requireCourseEditor(ctx, actor, courseId);
  await ctx.db.patch("courses", courseId, { joinEnabled: enabled, updatedAt: Date.now() });
  await logAudit(ctx, actor, {
    action: "course.joinEnabled",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `${enabled ? "Enabled" : "Disabled"} joining "${course.title}"`,
  });
}
