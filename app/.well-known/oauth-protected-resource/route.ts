import { METADATA_CORS_HEADERS, protectedResourceMetadata, publicOrigin } from "@/lib/mcp/oauth";

/**
 * Where an MCP client (claude.ai, ChatGPT…) learns that /api/mcp needs a
 * signed-in Kalami account and that Clerk is where to sign in. /api/mcp points
 * here in its 401 answer (WWW-Authenticate: resource_metadata=…).
 */

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(publicOrigin(req)), { headers: METADATA_CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS });
}
