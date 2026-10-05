// Copies what the student app shares with this repo into ../kalami:
// the code sandbox components, the checks engine that grades HTML/CSS, and the
// lesson renderer (students read lessons with it; the staff editor previews with it),
// and the MCP connector's OAuth helper.
// This repo is the source of truth; never edit the copies in the student app.
import { cpSync, rmSync } from "node:fs";

const shared = [
  ["convex/lib/checks", "../kalami/lib/checks"],
  ["components/sandbox", "../kalami/components/sandbox"],
  ["components/lessons", "../kalami/components/lessons"],
  // The MCP connector's OAuth side (Clerk tokens, the service credential); each app has its own server.ts.
  ["lib/mcp/oauth.ts", "../kalami/lib/mcp/oauth.ts"],
];

for (const [from, to] of shared) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (path) => !path.endsWith(".test.ts") });
  console.log(`${from} -> ${to}`);
}
