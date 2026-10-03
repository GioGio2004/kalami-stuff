import type { CodeFile, SandboxAsset } from "./types";

/**
 * Turns the student's files into one HTML document for the preview iframe.
 *
 * - `<link rel="stylesheet" href="style.css">` becomes that file's CSS. A
 *   forgotten link means no CSS, exactly as on a real website.
 * - Images are referenced by short name (`cat.jpg`) and point at the task's
 *   ImageKit URLs. Students can't use any other image or upload their own.
 * - A Content-Security-Policy goes first in <head>: the page can't load
 *   anything except those images and Google Fonts. The iframe itself runs no
 *   scripts at all (sandbox without allow-scripts).
 */

/** Where task images live; set NEXT_PUBLIC_CODE_ASSET_URL_PREFIX to the Kalami ImageKit endpoint. */
export const ASSET_URL_PREFIX = process.env.NEXT_PUBLIC_CODE_ASSET_URL_PREFIX ?? "https://ik.imagekit.io/";

function cspFor(prefix: string): string {
  const assets = /^https:\/\/[^\s;,'"]+$/.test(prefix) ? prefix : "";
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    `img-src data: ${assets}`.trim(),
    `media-src ${assets || "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function normalizeRef(ref: string): string {
  return ref.trim().replace(/^\.\//, "").replace(/[?#].*$/, "");
}

/** Stops `</style>` inside CSS from ending the style element early. */
function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function rewriteCssUrls(css: string, assets: Map<string, string>): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, ref: string) => {
    const url = assets.get(normalizeRef(ref));
    return url === undefined ? match : `url(${quote}${url}${quote})`;
  });
}

export function buildPreviewHtml(files: CodeFile[], assets: SandboxAsset[]): string {
  const index = files.find((f) => f.name === "index.html")?.content ?? "";
  const sheets = new Map(files.filter((f) => f.name.endsWith(".css")).map((f) => [f.name, f.content]));
  const assetUrls = new Map(assets.map((a) => [a.name, a.url]));

  let page = index
    // A <meta http-equiv="refresh"> would navigate the preview away.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      const css = href === null ? undefined : sheets.get(normalizeRef(href[1] ?? href[2] ?? href[3] ?? ""));
      return css === undefined ? tag : `<style>${escapeStyle(rewriteCssUrls(css, assetUrls))}</style>`;
    })
    .replace(
      /(\s(?:src|href|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
      (match, attr: string, double?: string, single?: string) => {
        const url = assetUrls.get(normalizeRef(double ?? single ?? ""));
        return url === undefined ? match : `${attr}"${url}"`;
      },
    )
    .replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (_m, attr: string, quote: string, css: string) =>
      `${attr}${quote}${rewriteCssUrls(css, assetUrls)}${quote}`,
    );

  const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor(ASSET_URL_PREFIX)}">`;
  const head = /<head\b[^>]*>/i.exec(page);
  if (head !== null) {
    page = page.slice(0, head.index + head[0].length) + meta + page.slice(head.index + head[0].length);
  } else {
    // Keep a <!DOCTYPE> first: anything before it switches the page to quirks mode.
    const doctype = /^\s*<!doctype[^>]*>/i.exec(page);
    const at = doctype === null ? 0 : doctype[0].length;
    page = page.slice(0, at) + `<head>${meta}</head>` + page.slice(at);
  }
  return page;
}
