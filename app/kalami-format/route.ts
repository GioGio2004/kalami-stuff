import { KALAMI_GUIDE } from "@/lib/kalami/guide";

// The .kalami authoring guide as Markdown, for people and AI assistants that
// write course files without the MCP connector. Public.

export function GET() {
  return new Response(KALAMI_GUIDE, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
