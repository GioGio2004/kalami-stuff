import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import { HONESTY_NOTICE } from "./honestyNotice";
import { normalizeEmail } from "./input";
import type { Role } from "./validators";

// Subdomains are the fence; these checks are the lock. Every public function
// that touches data derives the caller from ctx.auth, never from its arguments.
//
// Two rules hold for every check in this file, including ones added later:
// 1. An account is a student or staff, never both (onboarding refuses staff,
//    invites refuse students).
// 2. The super admin (the platform owner) is the one exception to everything:
//    they pass every role check, may also hold a student profile, and are never
//    blocked by the student/staff split. New helpers must start with isSuperAdmin.

export function isStaffRole(role: Role): boolean {
  return role === "lecturer" || role === "uni_admin" || role === "super_admin";
}

export function isSuperAdmin(memberships: Doc<"memberships">[]): boolean {
  return memberships.some((m) => m.role === "super_admin");
}

/** Whether rule 1 (student xor staff) applies to this person. */
export function isStaffOnly(memberships: Doc<"memberships">[]): boolean {
  return !isSuperAdmin(memberships) && memberships.some((m) => isStaffRole(m.role));
}

/** Clerk renders claims the user has no value for (e.g. no last name) as null. */
function claimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function requireIdentity(ctx: QueryCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw appError("UNAUTHENTICATED", "Please sign in.");
  }
  return identity;
}

export async function userByTokenIdentifier(ctx: QueryCtx, tokenIdentifier: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

export async function userByClerkUserId(ctx: QueryCtx, clerkUserId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

/**
 * After a move to a new Clerk application, people sign up again with the same
 * email and get a new Clerk id. Their row from the old application (a
 * different issuer in its tokenIdentifier) is handed over, so roles, courses
 * and work carry over. Only rows from another issuer qualify: two accounts of
 * the current Clerk application with the same email never merge.
 */
export async function userFromPreviousClerkApp(ctx: QueryCtx, email: string, issuer: string) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(5);
  const prefix = `${issuer.replace(/\/+$/, "")}|`;
  const stale = rows.filter((row) => !row.tokenIdentifier.startsWith(prefix));
  return stale.length === 1 ? stale[0] : null;
}

/**
 * The tokenIdentifier Convex will compute for this Clerk user (`issuer|subject`).
 * Lets a webhook create the row before the person's first signed-in request.
 */
export function clerkTokenIdentifier(clerkUserId: string): string {
  return `${clerkIssuer()}|${clerkUserId}`;
}

/** The Clerk Frontend API URL this deployment trusts, as Convex writes it in tokenIdentifiers. */
export function clerkIssuer(): string {
  const issuer = process.env.CLERK_FRONTEND_API_URL;
  if (!issuer) {
    throw new Error("CLERK_FRONTEND_API_URL is not set on this Convex deployment");
  }
  return issuer.replace(/\/+$/, "");
}

/** The signed-in user's row, or null when signed out or not stored yet. */
export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  return await userByTokenIdentifier(ctx, identity.tokenIdentifier);
}

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  const user = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (user === null) {
    throw appError("USER_NOT_FOUND", "Your account is still being set up. Refresh the page.");
  }
  return user;
}

/**
 * Creates or refreshes the signed-in user's row. Email and avatar follow Clerk on
 * every call; names are only seeded once, because students set them at onboarding.
 */
export async function ensureUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  const rawEmail = claimString(identity.email);
  if (rawEmail === undefined) {
    throw appError(
      "MISSING_EMAIL_CLAIM",
      "The session token has no email claim. Add it in Clerk under Sessions → Customize session token.",
    );
  }
  const email = normalizeEmail(rawEmail);
  const avatarUrl = claimString(identity.pictureUrl);
  // Clerk's subject is the Clerk user id. Matching on it alone is safe here because
  // this deployment trusts exactly one issuer (see auth.config.ts).
  const clerkUserId = identity.subject;

  // The Clerk webhook may have created the row first; adopt it either way. After a
  // move to a new Clerk app, the row from the old one is taken over, but only for
  // a verified email.
  const existing =
    (await userByTokenIdentifier(ctx, identity.tokenIdentifier)) ??
    (await userByClerkUserId(ctx, clerkUserId)) ??
    (identity.emailVerified === true ? await userFromPreviousClerkApp(ctx, email, identity.issuer) : null);
  if (existing !== null) {
    const fresh = {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId,
      email,
      avatarUrl,
    };
    if (
      existing.tokenIdentifier === fresh.tokenIdentifier &&
      existing.clerkUserId === fresh.clerkUserId &&
      existing.email === fresh.email &&
      existing.avatarUrl === fresh.avatarUrl
    ) {
      return existing;
    }
    await ctx.db.patch("users", existing._id, fresh);
    return { ...existing, ...fresh };
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId,
    email,
    firstName: claimString(identity.givenName),
    lastName: claimString(identity.familyName),
    avatarUrl,
    locale: "ka",
  });
  const user = await ctx.db.get("users", userId);
  if (user === null) {
    throw new Error("User row vanished right after insert");
  }
  return user;
}

export async function getMemberships(ctx: QueryCtx, userId: Id<"users">) {
  // A person holds a handful of roles at most; the cap only guards against bad data.
  return await ctx.db
    .query("memberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100);
}

/** Lecturers, university admins and the super admin. */
export async function requireStaff(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  const staffMemberships = memberships.filter((m) => isStaffRole(m.role));
  if (staffMemberships.length === 0) {
    throw appError("FORBIDDEN", "This is only for lecturers and university staff.");
  }
  return { user, memberships: staffMemberships };
}

export async function requireSuperAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  if (!isSuperAdmin(memberships)) {
    throw appError("FORBIDDEN", "Only the platform admin can do this.");
  }
  return { user };
}

/** A uni_admin of this university, or the super admin. */
export async function requireUniversityAdmin(ctx: QueryCtx, universityId: Id<"universities">) {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  const superAdmin = isSuperAdmin(memberships);
  const isUniversityAdmin = memberships.some(
    (m) => m.role === "uni_admin" && m.universityId === universityId,
  );
  if (!superAdmin && !isUniversityAdmin) {
    throw appError("FORBIDDEN", "You don't administer this university.");
  }
  return { user, isSuperAdmin: superAdmin };
}

/** Profile, names and the current honesty notice: everything the student app requires. */
export function hasCompletedOnboarding(
  user: Doc<"users">,
  studentMembership: Doc<"memberships"> | undefined,
): boolean {
  return (
    studentMembership?.universityId !== undefined &&
    user.honestyVersion === HONESTY_NOTICE.version &&
    user.firstName !== undefined &&
    user.lastName !== undefined
  );
}

/**
 * Onboarded students who accepted the current honesty notice. Staff accounts are
 * refused (rule 1); the super admin is not, but still needs a student profile,
 * because student data hangs off a university.
 */
export async function requireStudent(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  if (isStaffOnly(memberships)) {
    throw appError("FORBIDDEN", "Staff accounts can't use the student app.");
  }
  const membership = memberships.find((m) => m.role === "student");
  if (membership?.universityId === undefined || !hasCompletedOnboarding(user, membership)) {
    throw appError("FORBIDDEN", "Finish onboarding first.");
  }
  return { user, membership, universityId: membership.universityId };
}
