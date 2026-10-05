import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { deployGuardStatus } from "./model/platform";

/**
 * For scripts/predeploy.mjs: whether students are in the middle of timed work
 * right now, or work closes within the next two hours with attempts still
 * open. A deploy restarts the apps' bundles; it must not land in an exam.
 * The admin panel's System page shows the same answer (platform.system).
 */
export const deployGuard = internalQuery({
  args: {},
  returns: v.object({ busy: v.boolean(), reason: v.string() }),
  handler: async (ctx) => await deployGuardStatus(ctx, Date.now()),
});
