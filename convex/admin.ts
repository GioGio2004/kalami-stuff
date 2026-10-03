import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getMemberships, isStaffRole } from "./lib/auth";
import { normalizeEmail } from "./lib/input";
import { generateToken, hashToken, tokenPrefix } from "./lib/tokens";
import { logAudit } from "./model/audit";

async function staffUserByEmail(ctx: Parameters<typeof getMemberships>[0], rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (user === null) {
    throw new Error(`No user with email ${email}.`);
  }
  const memberships = await getMemberships(ctx, user._id);
  if (!memberships.some((m) => isStaffRole(m.role))) {
    throw new Error(`${email} is not staff.`);
  }
  return { user, memberships };
}

/**
 * Support tool: mints an MCP token for a staff member from the CLI, for smoke tests
 * and for helping someone who can't reach /agents. Internal, so only the deploy key
 * can run it, and it is audit-logged like a token made in the dashboard:
 *   npx convex run admin:mintAgentToken '{"email":"...","name":"Support"}'
 */
export const mintAgentToken = internalMutation({
  args: { email: v.string(), name: v.string() },
  returns: v.object({ tokenId: v.id("mcpTokens"), token: v.string() }),
  handler: async (ctx, args) => {
    const { user, memberships } = await staffUserByEmail(ctx, args.email);
    const token = generateToken();
    const tokenId = await ctx.db.insert("mcpTokens", {
      userId: user._id,
      name: args.name,
      tokenHash: await hashToken(token),
      prefix: tokenPrefix(token),
    });
    await logAudit(ctx, { user, memberships, via: "web" }, {
      action: "token.create",
      targetTable: "mcpTokens",
      targetId: tokenId,
      summary: `Created agent token "${args.name}" (from the CLI)`,
    });
    return { tokenId, token };
  },
});

/** Counterpart of mintAgentToken: npx convex run admin:revokeAgentToken '{"tokenId":"..."}' */
export const revokeAgentToken = internalMutation({
  args: { tokenId: v.id("mcpTokens") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("mcpTokens", args.tokenId);
    if (row !== null && row.revokedAt === undefined) {
      await ctx.db.patch("mcpTokens", row._id, { revokedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Bootstrap the platform owner. Internal, so only the CLI or dashboard can run it:
 *   npx convex run admin:grantSuperAdmin '{"email":"you@example.com"}'
 * The person must have signed in to either app once so their users row exists.
 */
export const grantSuperAdmin = internalMutation({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (users.length === 0) {
      throw new Error(`No user with email ${email} yet. Sign in to either app first.`);
    }
    if (users.length > 1) {
      throw new Error(`More than one user has the email ${email}; resolve that first.`);
    }
    const user = users[0];
    const memberships = await getMemberships(ctx, user._id);
    if (memberships.some((m) => m.role === "super_admin")) {
      return `${email} is already a super admin.`;
    }
    // The super admin is exempt from the student/staff split, so any account can be
    // promoted; it keeps its student profile, if it has one.
    await ctx.db.insert("memberships", { userId: user._id, role: "super_admin" });
    return `${email} is now a super admin.`;
  },
});
