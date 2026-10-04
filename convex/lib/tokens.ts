// Join codes avoid look-alike characters (0/O, 1/I/L). Mutation randomness
// comes from a per-execution seed clients can't see.
const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join("");
}

/**
 * The secret in a shareable link (a group's join link, a personal invite):
 * 120 random bits in 20 URL-safe characters.
 */
export function generateLinkToken(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(15)));
}

// --- Signed tokens --------------------------------------------------------------------
//
// One secret, MCP_SERVICE_SECRET, known to the staff app's server and to Convex,
// signs two kinds of short strings: the service credential the MCP connector
// sends with every call, and the unsubscribe token in notification emails.
// Each kind signs a different prefix, so one can never be mistaken for the other.

function serviceSecret(): string | null {
  const secret = process.env.MCP_SERVICE_SECRET;
  return secret ? secret : null;
}

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** HMAC-SHA256 of `message`, base64url. Null without a secret. */
export async function sign(message: string): Promise<string | null> {
  const secret = serviceSecret();
  if (secret === null) return null;
  const key = await hmacKey(secret, "sign");
  return toBase64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

/** Constant-time check of a base64url signature over `message`. False without a secret or on any malformed input. */
export async function verify(message: string, signature: string): Promise<boolean> {
  const secret = serviceSecret();
  if (secret === null || signature === "") return false;
  try {
    const key = await hmacKey(secret, "verify");
    return await crypto.subtle.verify("HMAC", key, fromBase64url(signature), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

// --- The MCP service credential ------------------------------------------------------
//
// `svc.<payload>.<signature>`: the staff app checked the lecturer's Clerk access
// token and says "this request is for Clerk user `u`, issued at `i`, until `e`".
// Convex checks the signature, that it hasn't expired, and that nobody signed
// one that lives longer than the staff app ever would.

const SERVICE_CREDENTIAL_PREFIX = "svc.";
/** The longest life a credential may claim; the staff app issues much shorter ones. */
const MAX_CREDENTIAL_LIFE_MS = 10 * 60 * 1000;

/** The Clerk user id a service credential speaks for, or null if it is forged, malformed or expired. */
export async function verifyServiceCredential(credential: string): Promise<string | null> {
  const [prefix, payload, signature, extra] = credential.split(".");
  if (`${prefix}.` !== SERVICE_CREDENTIAL_PREFIX || !payload || !signature || extra !== undefined) {
    return null;
  }
  if (!(await verify(payload, signature))) return null;
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (typeof data !== "object" || data === null) return null;
    const { u, e, i } = data as { u?: unknown; e?: unknown; i?: unknown };
    if (typeof u !== "string" || typeof e !== "number" || e < Date.now()) return null;
    const issuedAt = typeof i === "number" ? i : e - MAX_CREDENTIAL_LIFE_MS;
    if (e - issuedAt > MAX_CREDENTIAL_LIFE_MS || issuedAt > Date.now() + 60_000) return null;
    return u;
  } catch {
    return null;
  }
}

// --- Email unsubscribe tokens ---------------------------------------------------------

/** A token that lets whoever holds the email switch that person's notification emails off. */
export async function unsubscribeToken(userId: string): Promise<string | null> {
  return await sign(`unsubscribe:${userId}`);
}

export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  return await verify(`unsubscribe:${userId}`, token);
}
