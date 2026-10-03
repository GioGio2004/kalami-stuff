// Copies what the student app shares with this repo into ../kalami:
// the code sandbox components and the checks engine that grades HTML/CSS.
// This repo is the source of truth; never edit the copies in the student app.
import { cpSync, rmSync } from "node:fs";

const shared = [
  ["convex/lib/checks", "../kalami/lib/checks"],
  ["components/sandbox", "../kalami/components/sandbox"],
];

for (const [from, to] of shared) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (path) => !path.endsWith(".test.ts") });
  console.log(`${from} -> ${to}`);
}
