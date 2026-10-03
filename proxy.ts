import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Staff app: everything needs a signed-in user except the landing page, Clerk's own
// pages and invite links (an invitee may not have an account yet). Roles are
// enforced in Convex.
// The MCP connector authenticates with its own tokens (see lib/mcp/server.ts).
// /.well-known stays public so MCP clients probing for OAuth metadata get a
// clean 404 instead of a sign-in redirect.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/invite(.*)",
  "/api/mcp(.*)",
  "/.well-known(.*)",
]);
// Sample-data screen gallery; the page itself 404s outside development too.
const isDevGallery = createRouteMatcher(["/dev(.*)"]);

export default clerkMiddleware(
  async (auth, request) => {
    const devGallery = process.env.NODE_ENV === "development" && isDevGallery(request);
    if (!isPublicRoute(request) && !devGallery) {
      await auth.protect();
    }
  },
  // Our own branded pages, even when the NEXT_PUBLIC_CLERK_SIGN_*_URL env vars are missing.
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk's Frontend API proxy path
    "/__clerk/:path*",
  ],
};
