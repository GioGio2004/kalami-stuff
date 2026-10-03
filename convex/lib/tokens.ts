// Join codes avoid look-alike characters (0/O, 1/I/L). Mutation randomness
// comes from a per-execution seed clients can't see.
const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join("");
}

// "Sign in with Kalami" (OAuth) on the MCP connector: the staff app checks the
// Clerk access token, then passes `svc.<payload>.<signature>` here, signed with
// MCP_SERVICE_SECRET, which only the staff app's server and Convex know. The
// payload is { u: clerkUserId, e: expiry in ms }.

const SERVICE_CREDENTIAL_PREFIX = "svc.";

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The Clerk user id a service credential speaks for, or null if it is forged, malformed or expired. */
export async function verifyServiceCredential(credential: string): Promise<string | null> {
  const secret = process.env.MCP_SERVICE_SECRET;
  const [prefix, payload, signature, extra] = credential.split(".");
  if (!secret || `${prefix}.` !== SERVICE_CREDENTIAL_PREFIX || !payload || !signature || extra !== undefined) {
    return null;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const data: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as { u?: unknown }).u !== "string" ||
      typeof (data as { e?: unknown }).e !== "number" ||
      (data as { e: number }).e < Date.now()
    ) {
      return null;
    }
    return (data as { u: string }).u;
  } catch {
    return null;
  }
}
