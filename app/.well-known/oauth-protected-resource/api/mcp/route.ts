// The same metadata at the path-specific address RFC 9728 also allows
// (/.well-known/oauth-protected-resource + /api/mcp), which some clients try first.
export { GET, OPTIONS } from "../../route";

export const dynamic = "force-dynamic";
