import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffActor } from "./lib/access";
import { appError } from "./lib/errors";
import { requireText } from "./lib/input";
import { generateToken, hashToken, tokenPrefix } from "./lib/tokens";
import { logAudit } from "./model/audit";

// Personal access tokens that let a lecturer's AI agent use the MCP connector
// (app/api/mcp in the staff app) as them. Staff only; students can't have one.

const MAX_ACTIVE_TOKENS = 10;

const tokenRowValidator = v.object({
  _id: v.id("mcpTokens"),
  _creationTime: v.number(),
  name: v.string(),
  prefix: v.string(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const list = query({
  args: {},
  returns: v.array(tokenRowValidator),
  handler: async (ctx) => {
    const actor = await requireStaffActor(ctx);
    const rows = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId", (q) => q.eq("userId", actor.user._id))
      .order("desc")
      .take(50);
    return rows.map(({ _id, _creationTime, name, prefix, lastUsedAt, revokedAt }) => ({
      _id,
      _creationTime,
      name,
      prefix,
      lastUsedAt,
      revokedAt,
    }));
  },
});

/** Returns the token once. Only its hash is stored, so it can't be shown again. */
export const create = mutation({
  args: { name: v.string() },
  returns: v.object({ tokenId: v.id("mcpTokens"), token: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const name = requireText(args.name, "Name", 60);
    // Only active tokens, however many revoked ones the user has piled up.
    const active = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId_and_revokedAt", (q) =>
        q.eq("userId", actor.user._id).eq("revokedAt", undefined),
      )
      .take(MAX_ACTIVE_TOKENS + 1);
    if (active.length >= MAX_ACTIVE_TOKENS) {
      throw appError(
        "CONFLICT",
        `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`,
      );
    }
    const token = generateToken();
    const tokenId = await ctx.db.insert("mcpTokens", {
      userId: actor.user._id,
      name,
      tokenHash: await hashToken(token),
      prefix: tokenPrefix(token),
    });
    await logAudit(ctx, actor, {
      action: "token.create",
      targetTable: "mcpTokens",
      targetId: tokenId,
      summary: `Created agent token "${name}"`,
    });
    return { tokenId, token };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("mcpTokens") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    const row = await ctx.db.get("mcpTokens", args.tokenId);
    // Other people's tokens look like they don't exist.
    if (row === null || row.userId !== actor.user._id) {
      throw appError("NOT_FOUND", "Token not found.");
    }
    if (row.revokedAt === undefined) {
      await ctx.db.patch("mcpTokens", row._id, { revokedAt: Date.now() });
      await logAudit(ctx, actor, {
        action: "token.revoke",
        targetTable: "mcpTokens",
        targetId: row._id,
        summary: `Revoked agent token "${row.name}"`,
      });
    }
    return null;
  },
});
