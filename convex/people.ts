import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Actor } from "./lib/access";
import { getMemberships, requireSuperAdmin } from "./lib/auth";
import { appError } from "./lib/errors";
import { localizedTextValidator, roleValidator } from "./lib/validators";
import { displayName, logAudit } from "./model/audit";
import { stopTeachingAtUniversity } from "./model/groups";

/**
 * People, for the super admin: find someone by email and change their staff
 * role. Roles live in `memberships` (role + university). Only lecturer and
 * university admin rows change here; students stay students (an account is
 * student or staff, never both) and making a super admin stays a CLI step
 * (admin:grantSuperAdmin).
 */

const MAX_RESULTS = 25;
const staffRoleValidator = v.union(v.literal("lecturer"), v.literal("uni_admin"));

const personValidator = v.object({
  _id: v.id("users"),
  email: v.string(),
  // Empty while they haven't given a name.
  name: v.string(),
  memberships: v.array(
    v.object({
      _id: v.id("memberships"),
      role: roleValidator,
      universityId: v.optional(v.id("universities")),
      universityName: v.optional(localizedTextValidator),
    }),
  ),
});

/** People whose email starts with the query (at least two characters), by email. Deleted accounts are left out. */
export const search = query({
  args: { query: v.string() },
  returns: v.array(personValidator),
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const needle = args.query.trim().toLowerCase().slice(0, 254);
    if (needle.length < 2) {
      return [];
    }
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.gte("email", needle).lt("email", `${needle}￿`))
      .take(MAX_RESULTS);
    const universities = new Map<Id<"universities">, Doc<"universities"> | null>();
    const out = [];
    for (const user of users) {
      if (user.deletedAt !== undefined) continue;
      const memberships = [];
      for (const membership of await getMemberships(ctx, user._id)) {
        let universityName;
        if (membership.universityId !== undefined) {
          if (!universities.has(membership.universityId)) {
            universities.set(membership.universityId, await ctx.db.get("universities", membership.universityId));
          }
          universityName = universities.get(membership.universityId)?.name;
        }
        memberships.push({ _id: membership._id, role: membership.role, universityId: membership.universityId, universityName });
      }
      out.push({
        _id: user._id,
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        memberships,
      });
    }
    return out;
  },
});

/** The super admin and the staff membership they're about to change. */
async function requireStaffMembership(ctx: MutationCtx, membershipId: Id<"memberships">) {
  const { user } = await requireSuperAdmin(ctx);
  const membership = await ctx.db.get("memberships", membershipId);
  const person = membership === null ? null : await ctx.db.get("users", membership.userId);
  if (membership === null || person === null || person.deletedAt !== undefined) {
    throw appError("NOT_FOUND", "That person or role no longer exists.");
  }
  if (membership.role !== "lecturer" && membership.role !== "uni_admin") {
    throw appError(
      "CONFLICT",
      membership.role === "student"
        ? "Student accounts stay students. Invite another email address to make them staff."
        : "The platform admin role can't be changed here.",
    );
  }
  const actor: Actor = { user, memberships: await getMemberships(ctx, user._id), via: "web" };
  return { actor, membership, person };
}

/** When nothing else ties them to their old university, they stop teaching its groups. */
async function leftUniversity(ctx: MutationCtx, person: Doc<"users">, universityId: Id<"universities"> | undefined) {
  if (universityId === undefined) return;
  const stillThere = (await getMemberships(ctx, person._id)).some((m) => m.universityId === universityId);
  if (!stillThere) {
    await stopTeachingAtUniversity(ctx, person._id, universityId);
  }
}

const ROLE_NAME = { lecturer: "lecturer", uni_admin: "university admin" } as const;

/**
 * Lecturer ↔ university admin, and/or another university (a lecturer may also
 * become an independent teacher, with no university). Their courses stay where
 * they were created.
 */
export const changeStaffRole = mutation({
  args: {
    membershipId: v.id("memberships"),
    role: staffRoleValidator,
    universityId: v.optional(v.id("universities")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, membership, person } = await requireStaffMembership(ctx, args.membershipId);
    if (args.role === "uni_admin" && args.universityId === undefined) {
      throw appError("INVALID_INPUT", "A university admin needs a university.");
    }
    let universityName = "no university (independent teacher)";
    if (args.universityId !== undefined) {
      const university = await ctx.db.get("universities", args.universityId);
      if (university === null || university.status !== "active") {
        throw appError("NOT_FOUND", "That university isn't available.");
      }
      universityName = university.name.en;
    }
    if (membership.role === args.role && membership.universityId === args.universityId) {
      return null;
    }
    // Already has exactly that role there through another row: this one just goes.
    const duplicate = (await getMemberships(ctx, person._id)).some(
      (m) => m._id !== membership._id && m.role === args.role && m.universityId === args.universityId,
    );
    if (duplicate) {
      await ctx.db.delete("memberships", membership._id);
    } else {
      await ctx.db.patch("memberships", membership._id, { role: args.role, universityId: args.universityId });
    }
    if (membership.universityId !== args.universityId) {
      await leftUniversity(ctx, person, membership.universityId);
    }
    await logAudit(ctx, actor, {
      action: "people.changeRole",
      targetTable: "users",
      targetId: person._id,
      summary: `Made ${displayName(person)} a ${ROLE_NAME[args.role]} at ${universityName}`,
    });
    return null;
  },
});

/**
 * Takes a staff role away. Without any staff role left, the person can't use
 * the staff app; their courses stay, for the university's admins and the
 * super admin to manage.
 */
export const removeStaffRole = mutation({
  args: { membershipId: v.id("memberships") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, membership, person } = await requireStaffMembership(ctx, args.membershipId);
    await ctx.db.delete("memberships", membership._id);
    await leftUniversity(ctx, person, membership.universityId);
    await logAudit(ctx, actor, {
      action: "people.removeRole",
      targetTable: "users",
      targetId: person._id,
      summary: `Removed the ${ROLE_NAME[membership.role as "lecturer" | "uni_admin"]} role from ${displayName(person)}`,
    });
    return null;
  },
});
