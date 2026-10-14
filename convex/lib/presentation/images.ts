// Pictures in decks live on Kalami's ImageKit: convex/mediaActions.ts copies
// every upload or link there as a compressed WebP (at most 2400px wide). ImageKit
// resizes on request (`?tr=w-1280`), so the player asks for the width the
// screen needs instead of downloading the stored picture every time.

const DEFAULT_ENDPOINT = "https://ik.imagekit.io/kalami";

/** Where Kalami's pictures are served from (NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT, for a custom domain later). */
export const IMAGEKIT_ENDPOINT = (process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, "");

/** The widths the player picks from. */
export const IMAGE_WIDTHS = [640, 960, 1280, 1920, 2400] as const;

/** A picture Kalami stores (as opposed to a link to another site, from before pictures were copied in). */
export function isKalamiImage(url: string): boolean {
  return url.startsWith(`${IMAGEKIT_ENDPOINT}/`);
}

/** ImageKit can resize it: one of its addresses, without a transformation of its own. */
function resizable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const imageKit = parsed.hostname === "ik.imagekit.io" || isKalamiImage(url);
  return imageKit && !parsed.searchParams.has("tr") && !parsed.pathname.includes("/tr:");
}

/**
 * The picture at most `width` pixels wide (never enlarged); any other link as
 * it is. ImageKit keeps the format modern (WebP, or AVIF where the browser takes it).
 */
export function sizedImage(url: string, width: number): string {
  if (!resizable(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tr=w-${Math.round(width)},c-at_max`;
}

/** A srcset for a Kalami picture; undefined for a link the player can only show as it is. */
export function imageSrcSet(url: string): string | undefined {
  if (!resizable(url)) return undefined;
  return IMAGE_WIDTHS.map((width) => `${sizedImage(url, width)} ${width}w`).join(", ");
}
