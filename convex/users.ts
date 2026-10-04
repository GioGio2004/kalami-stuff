import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  clerkIssuer,
  clerkTokenIdentifier,
  ensureUser,
  getCurrentUser,
  getMemberships,
  hasCompletedOnboarding,
  isStaffOnly,
  isStaffRole,
  isSuperAdmin,
  requireUser,
  userByClerkUserId,
  userByTokenIdentifier,
  userFromPreviousClerkApp,
} from "./lib/auth";
import { appError } from "./lib/errors";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import { normalizeEmail, optionalText, requireText } from "./lib/input";
import { localeValidator, localizedTextValidator, roleValidator } from "./lib/validators";
import type { Doc } from "./_generated/dataModel";

/** Both apps call this right after sign-in to create or refresh the user's row. */
export const store = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const user = await ensureUser(ctx);
    return user._id;
  },
});

async function userForClerkId(ctx: MutationCtx, clerkUserId: string) {
  return (
    (await userByClerkUserId(ctx, clerkUserId)) ??
    (await userByTokenIdentifier(ctx, clerkTokenIdentifier(clerkUserId)))
  );
}

/**
 * Clerk `user.created` / `user.updated` (see http.ts). Same rules as ensureUser:
 * email and avatar follow Clerk; names are only seeded, never overwritten,
 * because students set their own at onboarding.
 */
export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    // Whether Clerk verified that address. Older callers don't say, which counts as no.
    emailVerified: v.optional(v.boolean()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const tokenIdentifier = clerkTokenIdentifier(args.clerkUserId);
    const current = await userForClerkId(ctx, args.clerkUserId);
    // After a move to a new Clerk app, the row from the old one carries over (see ensureUser),
    // but only to someone who proved they own the address: an unverified email never takes
    // over an account and its roles.
    const adopted =
      current === null && args.emailVerified === true
        ? await userFromPreviousClerkApp(ctx, email, clerkIssuer())
        : null;
    if (adopted !== null) {
      await ctx.db.patch("users", adopted._id, {
        tokenIdentifier,
        clerkUserId: args.clerkUserId,
        email,
        avatarUrl: args.avatarUrl,
      });
      return null;
    }
    const existing = current;
    if (existing === null) {
      await ctx.db.insert("users", {
        tokenIdentifier: clerkTokenIdentifier(args.clerkUserId),
        clerkUserId: args.clerkUserId,
        email,
        firstName: args.firstName,
        lastName: args.lastName,
        avatarUrl: args.avatarUrl,
        locale: "ka",
      });
      return null;
    }
    await ctx.db.patch("users", existing._id, {
      clerkUserId: args.clerkUserId,
      email,
      avatarUrl: args.avatarUrl,
      firstName: existing.firstName ?? args.firstName,
      lastName: existing.lastName ?? args.lastName,
    });
    return null;
  },
});

const DELETE_BATCH = 200;

/**
 * Clerk `user.deleted`: the person can no longer sign in, their roles, staff
 * seats, groups and enrollments go, their notifications are deleted, and the `users`
 * row is anonymised rather than deleted, so their attempts, grades and the
 * course history keep a valid reference ("Deleted account"). Safe to receive
 * twice: the second delivery finds nobody.
 */
export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await userForClerkId(ctx, args.clerkUserId);
    if (user === null) {
      return null;
    }
    for (const membership of await getMemberships(ctx, user._id)) {
      await ctx.db.delete("memberships", membership._id);
    }
    // Batched; deletes are visible to the next take in this mutation.
    for (;;) {
      const seats = await ctx.db
        .query("courseStaff")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(DELETE_BATCH);
      for (const seat of seats) {
        await ctx.db.delete("courseStaff", seat._id);
      }
      if (seats.length < DELETE_BATCH) {
        break;
      }
    }
    for (const member of await ctx.db
      .query("groupMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(DELETE_BATCH)) {
      await ctx.db.delete("groupMembers", member._id);
    }
    for (const enrollment of await ctx.db
      .query("enrollments")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(DELETE_BATCH)) {
      if (enrollment.status === "active") {
        await ctx.db.patch("enrollments", enrollment._id, { status: "removed" });
      }
    }
    for (;;) {
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(DELETE_BATCH);
      for (const row of rows) {
        await ctx.db.delete("notifications", row._id);
      }
      if (rows.length < DELETE_BATCH) {
        break;
      }
    }
    await ctx.db.patch("users", user._id, {
      tokenIdentifier: `deleted|${user._id}`,
      clerkUserId: undefined,
      email: `deleted-${user._id}@kalami.invalid`,
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
      emailOptOut: true,
      deletedAt: Date.now(),
    });
    return null;
  },
});

const meValidator = v.object({
  _id: v.id("users"),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  locale: localeValidator,
  memberships: v.array(
    v.object({ role: roleValidator, universityId: v.optional(v.id("universities")) }),
  ),
  isStaff: v.boolean(),
  isSuperAdmin: v.boolean(),
  honestyAccepted: v.boolean(),
  student: v.union(
    v.null(),
    v.object({
      // Both absent for a student outside any university.
      universityId: v.optional(v.id("universities")),
      universityName: v.optional(localizedTextValidator),
      faculty: v.optional(v.string()),
      group: v.optional(v.string()),
      year: v.optional(v.number()),
      studentNumber: v.optional(v.string()),
    }),
  ),
  // The student app sends the user to /onboarding while this is true.
  needsOnboarding: v.boolean(),
  // Staff: undefined until they dismiss the studio's "how this works" card.
  studioIntroSeenAt: v.optional(v.number()),
});

/** The signed-in user, or null when signed out or before `store` has run. */
export const me = query({
  args: {},
  returns: v.union(v.null(), meValidator),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return null;
    }
    const memberships = await getMemberships(ctx, user._id);
    const isStaff = memberships.some((m) => isStaffRole(m.role));
    const staffOnly = isStaffOnly(memberships);

    const studentMembership = memberships.find((m) => m.role === "student");
    const university = studentMembership?.universityId
      ? await ctx.db.get("universities", studentMembership.universityId)
      : null;
    const student =
      studentMembership !== undefined
        ? {
            universityId: university?._id,
            universityName: university?.name,
            faculty: studentMembership.faculty,
            group: studentMembership.group,
            year: studentMembership.year,
            studentNumber: studentMembership.studentNumber,
          }
        : null;

    return {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      memberships: memberships.map((m) => ({ role: m.role, universityId: m.universityId })),
      isStaff,
      isSuperAdmin: isSuperAdmin(memberships),
      honestyAccepted: user.honestyVersion === HONESTY_NOTICE.version,
      student,
      // Staff never onboard; students and the super admin (to use the student app) do.
      needsOnboarding:
        !staffOnly && (student === null || !hasCompletedOnboarding(user, studentMembership)),
      studioIntroSeenAt: user.studioIntroSeenAt,
    };
  },
});

/** The studio intro card shows once per staff account, on every device. */
export const markStudioIntroSeen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const memberships = await getMemberships(ctx, user._id);
    if (!memberships.some((m) => isStaffRole(m.role))) {
      throw appError("FORBIDDEN", "This is only for staff.");
    }
    if (user.studioIntroSeenAt === undefined) {
      await ctx.db.patch("users", user._id, { studioIntroSeenAt: Date.now() });
    }
    return null;
  },
});

/**
 * Onboarding form + honesty notice in one step. Re-running it updates the profile.
 * The university is optional (school classes, private lessons); with one, the
 * faculty, group and year are required too.
 */
export const completeStudentOnboarding = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    universityId: v.optional(v.id("universities")),
    faculty: v.optional(v.string()),
    group: v.optional(v.string()),
    year: v.optional(v.number()),
    studentNumber: v.optional(v.string()),
    locale: localeValidator,
    // The notice version the student actually read and accepted.
    honestyVersion: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const memberships = await getMemberships(ctx, user._id);
    if (isStaffOnly(memberships)) {
      throw appError("FORBIDDEN", "Staff accounts can't enrol as students.");
    }
    if (args.honestyVersion !== HONESTY_NOTICE.version) {
      throw appError("CONFLICT", "The honesty notice has changed. Please read it again.");
    }

    const firstName = requireText(args.firstName, "First name", 60);
    const lastName = requireText(args.lastName, "Last name", 60);
    // Moving a student between universities (or out of one) would orphan their
    // course data; it needs an admin, not a re-submitted form.
    const existing = memberships.find((m) => m.role === "student");
    if (existing?.universityId !== undefined && existing.universityId !== args.universityId) {
      throw appError("FORBIDDEN", "Your university can't be changed here. Ask your lecturer.");
    }
    let profile: Partial<Doc<"memberships">> = {
      universityId: undefined,
      faculty: undefined,
      group: undefined,
      year: undefined,
      studentNumber: undefined,
    };
    if (args.universityId !== undefined) {
      const university = await ctx.db.get("universities", args.universityId);
      if (university === null || university.status !== "active") {
        throw appError("NOT_FOUND", "That university isn't available.");
      }
      const year = args.year ?? 0;
      if (!Number.isInteger(year) || year < 1 || year > 8) {
        throw appError("INVALID_INPUT", "Year must be a whole number from 1 to 8.");
      }
      profile = {
        universityId: university._id,
        faculty: requireText(args.faculty ?? "", "Faculty", 120),
        group: requireText(args.group ?? "", "Group", 40),
        year,
        studentNumber: optionalText(args.studentNumber, "Student ID", 40),
      };
    }

    await ctx.db.patch("users", user._id, {
      firstName,
      lastName,
      locale: args.locale,
      honestyAcceptedAt: Date.now(),
      honestyVersion: HONESTY_NOTICE.version,
    });

    if (existing) {
      await ctx.db.patch("memberships", existing._id, profile);
    } else {
      await ctx.db.insert("memberships", { userId: user._id, role: "student", ...profile });
    }
    return null;
  },
});
