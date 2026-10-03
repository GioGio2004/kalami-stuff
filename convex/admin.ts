import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getMemberships } from "./lib/auth";
import { normalizeEmail } from "./lib/input";

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
