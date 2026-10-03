import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getMemberships, isStaffRole, isSuperAdmin, requireUser } from "./auth";
import { appError } from "./errors";
import { hashToken, looksLikeToken } from "./tokens";
import type { Via } from "./validators";

/**
 * Who is acting, resolved once per function call. The studio's model functions
 * take an Actor so the same code serves the web app (Clerk session) and the MCP
 * connector (personal access token). Both paths end in the same role checks.
 */
export type Actor = {
  user: Doc<"users">;
  memberships: Doc<"memberships">[];
  via: Via;
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
 * The owner of a personal access token, if it is valid, live and still belongs
 * to a staff member. The token is the credential: a revoked token, a deleted
 * account or a lost staff role all make it stop working at once.
 */
export async function actorFromToken(ctx: QueryCtx, token: string): Promise<Actor | null> {
  return (await resolveToken(ctx, token))?.actor ?? null;
}

/** The actor and the token row it came from, so callers don't hash and look up twice. */
async function resolveToken(
  ctx: QueryCtx,
  token: string,
): Promise<{ actor: Actor; row: Doc<"mcpTokens"> } | null> {
  if (!looksLikeToken(token)) {
    return null;
  }
  const tokenHash = await hashToken(token);
  const row = await ctx.db
    .query("mcpTokens")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (row === null || row.revokedAt !== undefined) {
    return null;
  }
  const user = await ctx.db.get("users", row.userId);
  if (user === null) {
    return null;
  }
  const memberships = await getMemberships(ctx, user._id);
  if (!canCreateCourses(memberships)) {
    return null;
  }
  return { actor: { user, memberships, via: "mcp" }, row };
}

export async function requireTokenActor(ctx: QueryCtx, token: string): Promise<Actor> {
  const actor = await actorFromToken(ctx, token);
  if (actor === null) {
    throw appError("UNAUTHENTICATED", "This access token is invalid or was revoked.");
  }
  return actor;
}

// "Last used" only needs minute precision. Writing it on every call would make
// an agent's back-to-back mutations conflict on the token row.
const LAST_USED_RESOLUTION_MS = 60_000;

/** Mutations also record that the token is in use; queries can't write. */
export async function requireTokenActorAndTouch(ctx: MutationCtx, token: string): Promise<Actor> {
  const resolved = await resolveToken(ctx, token);
  if (resolved === null) {
    throw appError("UNAUTHENTICATED", "This access token is invalid or was revoked.");
  }
  const { actor, row } = resolved;
  const now = Date.now();
  if (row.lastUsedAt === undefined || now - row.lastUsedAt > LAST_USED_RESOLUTION_MS) {
    await ctx.db.patch("mcpTokens", row._id, { lastUsedAt: now });
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
