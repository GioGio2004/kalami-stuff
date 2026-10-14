// What a link must look like before Kalami fetches a picture from it. Pure, so
// it runs anywhere and is tested; the fetch itself (fetch.ts) also checks the
// addresses a name resolves to, and every redirect, with the same rules.

/** The limits of copying a picture into Kalami. */
export const MEDIA_LIMITS = {
  /** The file as uploaded or downloaded. */
  inputBytes: 15 * 1024 * 1024,
  /** Decoded size: refuses "pixel bombs" (a tiny file that unpacks into gigabytes). */
  inputPixels: 50_000_000,
  /** JPEG and WebP decode straight at a smaller scale, so they may be bigger (phone cameras reach 108 MP). */
  inputPixelsShrinkable: 110_000_000,
  /** The longest side of the stored picture; ImageKit serves smaller sizes from it. */
  side: 2400,
  /** Quality steps down while the WebP is bigger than this. */
  targetBytes: 1024 * 1024,
  /** Frames of an animated GIF or WebP that are kept. */
  frames: 300,
  fetchTimeoutMs: 15_000,
  redirects: 3,
  url: 2000,
  fileName: 120,
} as const;

export type LinkCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Names that only mean something inside a network, never on the internet. */
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

/** True for an IPv4 or IPv6 address written as the host (with or without brackets). */
export function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":");
}

/**
 * True for an address that isn't on the public internet: loopback, private
 * ranges, link-local (cloud metadata lives there), carrier-grade NAT,
 * multicast, reserved, and their IPv6 forms (IPv4-mapped included).
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!ip.includes(":")) return true;
  return (
    ip === "::" ||
    ip === "::1" ||
    /^f[cd]/.test(ip) || // unique local fc00::/7
    /^fe[89ab]/.test(ip) || // link-local fe80::/10
    /^ff/.test(ip) || // multicast
    ip.startsWith("64:ff9b:") || // NAT64
    ip.startsWith("2001:db8:") // documentation
  );
}

/**
 * Whether Kalami may fetch a picture from this link: a full https:// address
 * with a public host name, no user name or password in it, the standard port.
 */
export function checkImageLink(raw: string): LinkCheck {
  const text = raw.trim();
  if (text === "" || text.length > MEDIA_LIMITS.url) {
    return { ok: false, reason: "Give the picture's full address, starting with https://." };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "That isn't a web address. Give the picture's full address, starting with https://." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Only https:// links can be copied in." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Links with a user name or password in them can't be copied in." };
  }
  if (url.port !== "" && url.port !== "443") {
    return { ok: false, reason: "Links to unusual ports can't be copied in." };
  }
  const host = url.hostname;
  if (isIpLiteral(host)) {
    return { ok: false, reason: "Use a link with a site name, not a bare IP address." };
  }
  if (!host.includes(".") || LOCAL_NAMES.test(host)) {
    return { ok: false, reason: "That address isn't on the public internet." };
  }
  url.hash = "";
  return { ok: true, url };
}

/** The link as remembered for "same link, same course: reuse the copy". */
export function linkKey(url: URL): string {
  return url.href;
}

/**
 * A file name for ImageKit from an uploaded file's name or a link's path:
 * letters, digits, - and _, ending in .webp (ImageKit adds a unique suffix).
 */
export function webpFileName(from: string | undefined): string {
  let path = from ?? "";
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep it as it is.
  }
  const base = path
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.[a-z0-9]{2,5}$/i, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "picture"}.webp`;
}
