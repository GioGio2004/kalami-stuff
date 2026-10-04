// Refuses to deploy while an exam is running or about to end, so a new bundle
// never lands under students' feet. Wire it in front of the production deploy:
//   node scripts/predeploy.mjs && npx convex deploy --cmd "npm run build"
// It asks the production deployment (CONVEX_DEPLOY_KEY, as on Vercel) through
// the internal query in convex/ops.ts. FORCE_DEPLOY=1 skips the check, for the
// one time a hotfix really can't wait.
import { execFileSync } from "node:child_process";

if (process.env.FORCE_DEPLOY === "1") {
  console.warn("predeploy: FORCE_DEPLOY is set, skipping the exam check");
  process.exit(0);
}

let output;
try {
  output = execFileSync("npx", ["convex", "run", "ops:deployGuard", "{}", "--prod"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  });
} catch (error) {
  console.error("predeploy: could not ask the backend whether an exam is running:", error.message);
  process.exit(1);
}

const line = output.trim().split("\n").at(-1) ?? "";
let result;
try {
  result = JSON.parse(line);
} catch {
  console.error(`predeploy: unexpected answer from the backend: ${line}`);
  process.exit(1);
}

if (result.busy) {
  console.error(`predeploy: refusing to deploy: ${result.reason}. Wait, or set FORCE_DEPLOY=1.`);
  process.exit(1);
}
console.log(`predeploy: ok, ${result.reason}`);
