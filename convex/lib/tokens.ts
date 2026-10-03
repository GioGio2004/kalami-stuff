// Personal access tokens for the MCP connector. The raw token is `klm_` followed
// by 40 hex characters (160 random bits). Only its SHA-256 is stored.

export const TOKEN_PREFIX = "klm_";
const TOKEN_HEX_LENGTH = 40;

/** Mutation randomness comes from a per-execution seed clients can't see. */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_HEX_LENGTH / 2));
  return TOKEN_PREFIX + toHex(bytes);
}

export function looksLikeToken(value: string): boolean {
  return new RegExp(`^${TOKEN_PREFIX}[0-9a-f]{${TOKEN_HEX_LENGTH}}$`).test(value);
}

/** What the token list shows: `klm_1a2b3c…`. */
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 6);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Join codes avoid look-alike characters (0/O, 1/I/L). */
const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join("");
}
