import { headerAuthHandler } from "@/lib/mcp/server";

/**
 * The MCP connector for clients that can send headers (Claude Code, Cursor,
 * VS Code, Gemini CLI, …): `Authorization: Bearer klm_…`. The server itself
 * lives in lib/mcp/server.ts; /api/mcp/k/[key] is the secret-link variant.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export { headerAuthHandler as GET, headerAuthHandler as POST, headerAuthHandler as DELETE };
