import { headerAuthHandler } from "@/lib/mcp/server";

/**
 * The MCP connector. Web assistants sign in with Kalami (OAuth via Clerk, see
 * lib/mcp/oauth.ts); clients with config files send `Authorization: Bearer klm_…`.
 * The server itself lives in lib/mcp/server.ts.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export { headerAuthHandler as GET, headerAuthHandler as POST, headerAuthHandler as DELETE };
