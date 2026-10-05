import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { sendStaffInviteEmail } from "./email";
import {
  ensureUser,
  getMemberships,
  isSuperAdmin,
  requireIdentity,
  requireSuperAdmin,
  requireUniversityAdmin,
} from "./lib/auth";
import { appError } from "./lib/errors";
import { requireEmail } from "./lib/input";
import { enforceLimit } from "./lib/limits";
import { inviteRoleValidator, localizedTextValidator } from "./lib/validators";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Asking for the same invite again sends the email again, but not sooner than this.
const RESEND_AFTER_MS = 10 * 60 * 1000;

/** What happened to the invitation email: sent, already sent minutes ago, or email isn't available. */
const emailOutcomeValidator = v.union(v.literal("sent"), v.literal("recent"), v.literal("off"));
type EmailOutcome = "sent" | "recent" | "off";

/**
 * Emails the invite unless it went out a few minutes ago. "off": sending isn't
 * configured here, or the address bounced or complained before.
 */
async function emailInvite(ctx: MutationCtx, invite: Doc<"invites">, inviter: Doc<"users">): Promise<EmailOutcome> {
  if (invite.emailedAt !== undefined && Date.now() - invite.emailedAt < RESEND_AFTER_MS) {
    return "recent";
  }
  return (await sendStaffInviteEmail(ctx, invite, inviter)) ? "sent" : "off";
}

/** 192 random bits. Mutation randomness comes from a per-execution seed clients can't see. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function inviteByToken(ctx: QueryCtx, token: string) {
  return await ctx.db
    .query("invites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

/**
 * Who may manage invites for this university, or for independent teachers
 * (no university): those only the super admin sends.
 */
async function requireInviteAdmin(ctx: QueryCtx, universityId: Id<"universities"> | undefined) {
  if (universityId === undefined) {
    const { user } = await requireSuperAdmin(ctx);
    return { user, isSuperAdmin: true };
  }
  return await requireUniversityAdmin(ctx, universityId);
}

/**
 * University admins invite lecturers; only the super admin can invite university
 * admins, and independent teachers (no university: a school, private lessons).
 * The invitation is emailed through Resend with its personal link; the link is
 * also returned, for copying when email isn't available.
 */
export const create = mutation({
  args: {
    universityId: v.optional(v.id("universities")),
    email: v.string(),
    role: inviteRoleValidator,
  },
  returns: v.object({ inviteId: v.id("invites"), token: v.string(), email: emailOutcomeValidator }),
  handler: async (ctx, args) => {
    const { user, isSuperAdmin } = await requireInviteAdmin(ctx, args.universityId);
    if (args.role === "uni_admin" && !isSuperAdmin) {
      throw appError("FORBIDDEN", "Only the platform admin can appoint university admins.");
    }
    if (args.role === "uni_admin" && args.universityId === undefined) {
      throw appError("INVALID_INPUT", "A university admin needs a university.");
    }
    await enforceLimit(ctx, "invite", user._id);
    if (args.universityId !== undefined) {
      const university = await ctx.db.get("universities", args.universityId);
      if (university === null || university.status !== "active") {
        throw appError("NOT_FOUND", "That university isn't available.");
      }
    }
    const email = requireEmail(args.email);
    // One open invite per address: resend the existing link instead of minting another.
    const open = (
      await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .take(20)
    ).find(
      (invite) =>
        invite.universityId === args.universityId &&
        invite.acceptedAt === undefined &&
        invite.revokedAt === undefined &&
        invite.expiresAt > Date.now(),
    );
    if (open !== undefined) {
      // Inviting the same person again sends the same link again.
      return { inviteId: open._id, token: open.token, email: await emailInvite(ctx, open, user) };
    }
    const token = generateToken();
    const inviteId = await ctx.db.insert("invites", {
      email,
      universityId: args.universityId,
      role: args.role,
      token,
      invitedBy: user._id,
      expiresAt: Date.now() + INVITE_TTL_MS,
    });
    const invite = (await ctx.db.get("invites", inviteId))!;
    return { inviteId, token, email: await emailInvite(ctx, invite, user) };
  },
});

/**
 * Sends a pending invitation's email again. An expired one gets a fresh
 * fortnight first, so the link in the new email works.
 */
export const resendEmail = mutation({
  args: { inviteId: v.id("invites") },
  returns: emailOutcomeValidator,
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("invites", args.inviteId);
    if (invite === null) {
      throw appError("NOT_FOUND", "Invite not found.");
    }
    const { user, isSuperAdmin } = await requireInviteAdmin(ctx, invite.universityId);
    if (invite.role === "uni_admin" && !isSuperAdmin) {
      throw appError("FORBIDDEN", "Only the platform admin can resend admin invites.");
    }
    if (invite.acceptedAt !== undefined || invite.revokedAt !== undefined) {
      throw appError("CONFLICT", "This invite is no longer open.");
    }
    await enforceLimit(ctx, "invite", user._id);
    let current = invite;
    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch("invites", invite._id, { expiresAt: Date.now() + INVITE_TTL_MS });
      current = (await ctx.db.get("invites", invite._id))!;
    }
    return await emailInvite(ctx, current, user);
  },
});

/** One university's invites, or (no universityId, super admin only) the independent teachers'. */
export const listForUniversity = query({
  args: { universityId: v.optional(v.id("universities")) },
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      _creationTime: v.number(),
      email: v.string(),
      role: inviteRoleValidator,
      // Only for pending invites the caller may send or withdraw.
      token: v.optional(v.string()),
      expiresAt: v.number(),
      acceptedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      emailedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const { isSuperAdmin } = await requireInviteAdmin(ctx, args.universityId);
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_universityId", (q) => q.eq("universityId", args.universityId))
      .order("desc")
      .take(100);
    return invites.map((invite) => {
      const pending = invite.acceptedAt === undefined && invite.revokedAt === undefined;
      const manageable = invite.role === "lecturer" || isSuperAdmin;
      return {
        _id: invite._id,
        _creationTime: invite._creationTime,
        email: invite.email,
        role: invite.role,
        token: pending && manageable ? invite.token : undefined,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        revokedAt: invite.revokedAt,
        emailedAt: invite.emailedAt,
      };
    });
  },
});

/**
 * Every staff invite, newest first, with the university it's for (none for an
 * independent teacher): the super admin's one list to keep track of who was
 * invited where.
 */
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      _creationTime: v.number(),
      email: v.string(),
      role: inviteRoleValidator,
      universityId: v.optional(v.id("universities")),
      universityName: v.optional(localizedTextValidator),
      // Only for pending invites, which can still be sent or withdrawn.
      token: v.optional(v.string()),
      expiresAt: v.number(),
      acceptedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      emailedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const invites = await ctx.db.query("invites").order("desc").take(500);
    const names = new Map<Id<"universities">, { ka: string; en: string } | undefined>();
    const out = [];
    for (const invite of invites) {
      let universityName: { ka: string; en: string } | undefined;
      if (invite.universityId !== undefined) {
        if (!names.has(invite.universityId)) {
          names.set(invite.universityId, (await ctx.db.get("universities", invite.universityId))?.name);
        }
        universityName = names.get(invite.universityId);
      }
      const pending = invite.acceptedAt === undefined && invite.revokedAt === undefined;
      out.push({
        _id: invite._id,
        _creationTime: invite._creationTime,
        email: invite.email,
        role: invite.role,
        universityId: invite.universityId,
        universityName,
        token: pending ? invite.token : undefined,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        revokedAt: invite.revokedAt,
        emailedAt: invite.emailedAt,
      });
    }
    return out;
  },
});

/**
 * Deliberately public: the invitee opens the link before they have an account.
 * The unguessable token is the secret, and accepting still requires the invited email.
 * Expiry is left to the caller because queries must not read the clock.
 */
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      role: inviteRoleValidator,
      // Absent for an independent teacher's invite.
      universityName: v.optional(localizedTextValidator),
      expiresAt: v.number(),
      status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.token.length > 128) {
      return null;
    }
    const invite = await inviteByToken(ctx, args.token);
    if (invite === null) {
      return null;
    }
    const university = invite.universityId === undefined ? undefined : await ctx.db.get("universities", invite.universityId);
    if (university === null) {
      return null;
    }
    return {
      email: invite.email,
      role: invite.role,
      universityName: university?.name,
      expiresAt: invite.expiresAt,
      status:
        invite.revokedAt !== undefined
          ? ("revoked" as const)
          : invite.acceptedAt !== undefined
            ? ("accepted" as const)
            : ("pending" as const),
    };
  },
});

export const accept = mutation({
  args: { token: v.string() },
  returns: v.object({ universityId: v.optional(v.id("universities")), role: inviteRoleValidator }),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const invite = await inviteByToken(ctx, args.token);
    if (invite === null || invite.revokedAt !== undefined) {
      throw appError("NOT_FOUND", "This invite doesn't exist or was withdrawn.");
    }
    const result = { universityId: invite.universityId, role: invite.role };
    if (invite.acceptedAt !== undefined) {
      if (invite.acceptedBy === user._id) {
        return result;
      }
      throw appError("CONFLICT", "This invite has already been used.");
    }
    if (invite.expiresAt < Date.now()) {
      throw appError("EXPIRED", "This invite has expired. Ask for a new one.");
    }
    // ensureUser just copied the email from the verified session token.
    if (user.email !== invite.email) {
      throw appError(
        "FORBIDDEN",
        `This invite is for ${invite.email}, but you're signed in as ${user.email}.`,
      );
    }
    // Owning the invited mailbox is the only thing between a token and a staff role,
    // so anything short of an explicit `true` (missing or null claim) is refused.
    const identity = await requireIdentity(ctx);
    if (identity.emailVerified !== true) {
      throw appError("FORBIDDEN", "Verify your email address first.");
    }
    const memberships = await getMemberships(ctx, user._id);
    if (!isSuperAdmin(memberships) && memberships.some((m) => m.role === "student")) {
      throw appError(
        "CONFLICT",
        "This is a student account. Staff need a separate account: ask for the invite to go to another email.",
      );
    }
    if (invite.universityId !== undefined) {
      const university = await ctx.db.get("universities", invite.universityId);
      if (university === null || university.status !== "active") {
        throw appError("NOT_FOUND", "That university isn't available.");
      }
    }

    const alreadyMember = memberships.some(
      (m) => m.role === invite.role && m.universityId === invite.universityId,
    );
    if (!alreadyMember) {
      await ctx.db.insert("memberships", {
        userId: user._id,
        universityId: invite.universityId,
        role: invite.role,
      });
    }
    await ctx.db.patch("invites", invite._id, { acceptedAt: Date.now(), acceptedBy: user._id });
    return result;
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("invites", args.inviteId);
    if (invite === null) {
      throw appError("NOT_FOUND", "Invite not found.");
    }
    const { isSuperAdmin } = await requireInviteAdmin(ctx, invite.universityId);
    if (invite.role === "uni_admin" && !isSuperAdmin) {
      throw appError("FORBIDDEN", "Only the platform admin can withdraw admin invites.");
    }
    if (invite.acceptedAt !== undefined) {
      throw appError("CONFLICT", "This invite was already accepted.");
    }
    if (invite.revokedAt === undefined) {
      await ctx.db.patch("invites", invite._id, { revokedAt: Date.now() });
    }
    return null;
  },
});
