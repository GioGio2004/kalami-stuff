import type { NextRequest } from "next/server";
import { handleVerified, verifyToken } from "@/lib/mcp/server";

/**
 * The secret-link MCP connector: /api/mcp/k/klm_…, for web assistants that
 * can't send an Authorization header (claude.ai, ChatGPT, Le Chat, …). The
 * token in the path works exactly like the bearer token on /api/mcp, so the
 * link is a password: revoking the token on /agents kills the link too.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function serve(req: NextRequest, ctx: RouteContext<"/api/mcp/k/[key]">): Promise<Response> {
  const { key } = await ctx.params;
  const authInfo = await verifyToken(req, key);
  if (!authInfo) {
    // No WWW-Authenticate challenge on purpose: there is no OAuth to fall back
    // to, and a challenge would send web clients looking for a sign-in page.
    return Response.json(
      { error: "This Kalami link is invalid or its token was revoked. Create a new one on the Agents page." },
      { status: 401 },
    );
  }
  return handleVerified(req, authInfo);
}

export { serve as GET, serve as POST, serve as DELETE };
