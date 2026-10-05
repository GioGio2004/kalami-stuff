import { clerkClient } from "@clerk/nextjs/server";

/**
 * "Sign in with Kalami" for MCP clients such as claude.ai. Clerk is the OAuth
 * authorization server: the client sends the person to Clerk, they sign in
 * with their own Kalami account and press Allow, and the client gets a
 * short-lived access token. No link or token to copy, so nothing to leak.
 *
 * This file is the resource-server side: the metadata that tells clients where
 * to sign in, checking Clerk's tokens, and a signed, short-lived credential
 * that tells Convex which Clerk user the request is for. Convex still decides
 * what that person may do (lib/access.ts: staff on the staff connector, an
 * onboarded student on the student app's).
 *
 * Shared by both apps: the copy in the student app comes from the staff repo
 * (scripts/sync-student.mjs); edit it there.
 */

/** A credential is minted per request and used within milliseconds; a minute covers slow calls. */
const SERVICE_CREDENTIAL_TTL_MS = 60 * 1000;

/** Clerk's Frontend API (the issuer), read from the publishable key: https://clerk.kalami.space in production. */
export function clerkIssuer(): string {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.split("_")[2] ?? "";
  const domain = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  if (!domain) {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or malformed");
  }
  return `https://${domain}`;
}

/** The origin people see (Vercel sits behind a proxy), for links and metadata. */
export function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** RFC 9728: tells MCP clients that /api/mcp is protected and Clerk is where to sign in. `docs` is the page that explains the connector. */
export function protectedResourceMetadata(origin: string, docs = "/agents") {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [clerkIssuer()],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "Kalami",
    resource_documentation: `${origin}${docs}`,
  };
}

/** RFC 8414 metadata of Clerk, served on our origin for clients that look for it here. */
export async function authorizationServerMetadata(): Promise<unknown> {
  const issuer = clerkIssuer();
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const res = await fetch(`${issuer}${path}`, { next: { revalidate: 3600 } });
    if (res.ok) {
      return await res.json();
    }
  }
  throw new Error("Clerk did not return OAuth metadata");
}

export const METADATA_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "public, max-age=300",
};

/**
 * The Clerk user behind an OAuth access token, or null if the token isn't a valid one.
 * MCP_OAUTH_AUDIENCE (e.g. https://staff.kalami.space/api/mcp) also binds the
 * token to this resource server, so a token minted for another app on the same
 * Clerk instance is refused. Opt-in: confirm Clerk applies it to the tokens your
 * clients get before setting it, or every connector breaks at once.
 */
export async function verifyOAuthToken(req: Request): Promise<{ userId: string; scopes: string[]; clientId?: string } | null> {
  const client = await clerkClient();
  const audience = process.env.MCP_OAUTH_AUDIENCE;
  const state = await client.authenticateRequest(req, {
    acceptsToken: "oauth_token",
    ...(audience ? { audience } : {}),
  });
  const auth = state.toAuth();
  if (!auth || !auth.isAuthenticated || auth.tokenType !== "oauth_token" || !auth.userId) {
    return null;
  }
  return { userId: auth.userId, scopes: auth.scopes ?? [], clientId: auth.clientId ?? undefined };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * `svc.<payload>.<signature>`: "this request is for Clerk user X, issued at I,
 * until E", signed with MCP_SERVICE_SECRET, which only this server and Convex
 * know. Convex checks the signature, the expiry and that the lifetime is short,
 * then looks the person up and their role.
 */
export async function serviceCredential(clerkUserId: string): Promise<string> {
  const secret = process.env.MCP_SERVICE_SECRET;
  if (!secret) {
    throw new Error("MCP_SERVICE_SECRET is not set");
  }
  const now = Date.now();
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ u: clerkUserId, i: now, e: now + SERVICE_CREDENTIAL_TTL_MS })),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${base64url(signature)}`;
}
