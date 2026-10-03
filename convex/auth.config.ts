import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk Frontend API URL: https://<slug>.clerk.accounts.dev in development,
      // https://clerk.<your-domain> in production. Set it per deployment with
      //   npx convex env set CLERK_FRONTEND_API_URL <url>
      domain: process.env.CLERK_FRONTEND_API_URL!,
      // Clerk's Convex integration puts aud: "convex" in the session token.
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
