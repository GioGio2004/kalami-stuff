import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getMemberships, isStaffRole, isSuperAdmin, requireUser, userByClerkUserId } from "./auth";
import { appError } from "./errors";
import { verifyServiceCredential } from "./tokens";
import type { Via } from "./validators";

/**
 * Who is acting, resolved once per function call. The studio's model functions
 * take an Actor so the same code serves the web app (Clerk session) and the MCP
 * connector (Sign in with Kalami). Both paths end in the same role checks.
 */
export type Actor = {
  user: Doc<"users">;
  memberships: Doc<"memberships">[];
  via: Via;
  /** MCP only: the OAuth client the agent connected through, for the audit log. */
  client?: string;
};

/** Lecturers, university admins and the super admin may create and edit. */
export function canCreateCourses(memberships: Doc<"memberships">[]): boolean {
  return memberships.some((m) => isStaffRole(m.role));
}

/** The signed-in staff member. Students are refused. */
export async function requireStaffActor(ctx: QueryCtx): Promise<Actor> {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  if (!canCreateCourses(memberships)) {
    throw appError("FORBIDDEN", "This is only for lecturers and university staff.");
  }
  return { user, memberships, via: "web" };
}

/**
 * The staff member an MCP request acts for. The lecturer signed in with Kalami
 * (Clerk OAuth) in their assistant; the staff app checked that access token and
 * sent `token`, a short-lived credential naming the Clerk user, signed with
 * MCP_SERVICE_SECRET. A forged or expired credential, a deleted account or a
 * lost staff role all get null.
 */
export async function actorFromToken(ctx: QueryCtx, token: string, client?: string): Promise<Actor | null> {
  const clerkUserId = await verifyServiceCredential(token);
  const user = clerkUserId === null ? null : await userByClerkUserId(ctx, clerkUserId);
  if (user === null || user.deletedAt !== undefined) {
    return null;
  }
  const memberships = await getMemberships(ctx, user._id);
  // Students can sign in to Clerk too; only staff get the tools.
  if (!canCreateCourses(memberships)) {
    return null;
  }
  return { user, memberships, via: "mcp", client };
}

export async function requireTokenActor(ctx: QueryCtx, token: string, client?: string): Promise<Actor> {
  const actor = await actorFromToken(ctx, token, client);
  if (actor === null) {
    throw appError("UNAUTHENTICATED", "Not signed in to Kalami as staff. Reconnect Kalami in your assistant.");
  }
  return actor;
}

/** Universities this actor may create courses in. Empty for the super admin means "any". */
export function creatorUniversityIds(actor: Actor): Id<"universities">[] {
  return actor.memberships.flatMap((m) =>
    isStaffRole(m.role) && m.universityId !== undefined ? [m.universityId] : [],
  );
}

export type CourseAccess = {
  course: Doc<"courses">;
  /** Owner, admin of the course's university, or the super admin. */
  canEdit: boolean;
  role: "owner" | "assistant" | "admin" | "super_admin";
};

/**
 * What this actor may do with a course. Everyone else gets NOT_FOUND, so the
 * existence of other people's courses isn't revealed either.
 */
export async function courseAccess(
  ctx: QueryCtx,
  actor: Actor,
  courseId: Id<"courses">,
): Promise<CourseAccess> {
  const course = await ctx.db.get("courses", courseId);
  if (course === null) {
    throw appError("NOT_FOUND", "Course not found.");
  }
  if (isSuperAdmin(actor.memberships)) {
    return { course, canEdit: true, role: "super_admin" };
  }
  if (
    course.universityId !== undefined &&
    actor.memberships.some((m) => m.role === "uni_admin" && m.universityId === course.universityId)
  ) {
    return { course, canEdit: true, role: "admin" };
  }
  const staff = await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", courseId).eq("userId", actor.user._id))
    .unique();
  if (staff === null) {
    throw appError("NOT_FOUND", "Course not found.");
  }
  return { course, canEdit: staff.role === "owner", role: staff.role };
}

export async function requireCourseEditor(
  ctx: QueryCtx,
  actor: Actor,
  courseId: Id<"courses">,
): Promise<CourseAccess> {
  const access = await courseAccess(ctx, actor, courseId);
  if (!access.canEdit) {
    throw appError("FORBIDDEN", "Only the course owner or a university admin can change this course.");
  }
  return access;
}

/**
 * For changes to what's inside a course (assessments, questions). Archived
 * courses are read-only; restoring one goes through updateCourse, which only
 * needs requireCourseEditor, so it isn't blocked by this.
 */
export async function requireCourseContentEditor(
  ctx: QueryCtx,
  actor: Actor,
  courseId: Id<"courses">,
): Promise<CourseAccess> {
  const access = await requireCourseEditor(ctx, actor, courseId);
  if (access.course.status === "archived") {
    throw appError("CONFLICT", "This course is archived. Restore it before editing.");
  }
  return access;
}
