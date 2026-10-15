// Copies what the student app shares with this repo into ../kalami:
// the code sandbox components, the checks engine that grades HTML/CSS, and the
// lesson renderer (students read lessons with it; the staff editor previews with it),
// and the MCP connector's OAuth helper.
// This repo is the source of truth; never edit the copies in the student app.
import { cpSync, rmSync } from "node:fs";

const shared = [
  ["convex/lib/checks", "../kalami/lib/checks"],
  // The scene rules the backend validates animated lesson scenes with; the player and editor share them.
  ["convex/lib/scene", "../kalami/lib/scene"],
  // Presentations: the deck rules (checked by the backend too) and the player students watch decks in.
  ["convex/lib/presentation", "../kalami/lib/presentation"],
  ["components/presentations", "../kalami/components/presentations"],
  // Crosswords: the rules and layout (checked by the backend too) and the grid students fill in.
  ["convex/lib/crossword", "../kalami/lib/crossword"],
  ["components/crossword", "../kalami/components/crossword"],
  // The fonts crossword PDFs are made with (Noto Sans Georgian: Georgian and Latin; SIL OFL).
  ["public/fonts/crossword", "../kalami/public/fonts/crossword"],
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
