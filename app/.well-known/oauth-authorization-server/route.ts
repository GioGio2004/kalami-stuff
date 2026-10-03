import { authorizationServerMetadata, METADATA_CORS_HEADERS } from "@/lib/mcp/oauth";

/**
 * Clerk's OAuth server metadata, also served on our own origin: some MCP
 * clients look for it next to the resource instead of following
 * authorization_servers. Clerk stays the server that signs people in.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await authorizationServerMetadata(), { headers: METADATA_CORS_HEADERS });
  } catch {
    return Response.json({ error: "Sign-in metadata is unavailable right now." }, { status: 502 });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS });
}
