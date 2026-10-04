import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import { defineApp } from "convex/server";

// Official Convex components: per-user rate limits (lib/limits.ts) and the
// Resend email queue (email.ts). Both live in their own tables under the app.
const app = defineApp();
app.use(rateLimiter);
app.use(resend);

export default app;
