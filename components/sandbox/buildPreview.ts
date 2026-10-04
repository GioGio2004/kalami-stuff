import { Text, type Document } from "domhandler";
import { findAll, findOne, prependChild, removeElement, replaceElement } from "domutils";
import { html, parse, serialize } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import type { CodeFile, SandboxAsset } from "./types";

/**
 * Turns the student's files into one HTML document for the preview iframe.
 *
 * The page is parsed the way a browser parses it (parse5), changed as a tree,
 * and written back, so nothing a student types can slip past the rules:
 *
 * - A Content-Security-Policy goes in as the first child of the real <head>:
 *   the page can't load anything except the task's images and Google Fonts.
 *   (A regex used to find "<head>"; a comment or a stray tag could fool it.)
 * - <script>, <iframe>, <object>, <embed>, <base> and <meta http-equiv="refresh">
 *   are dropped. The iframe runs no scripts anyway (sandbox without
 *   allow-scripts); this keeps the preview from navigating or embedding.
 * - `<link rel="stylesheet" href="style.css">` becomes that file's CSS inline.
 *   A forgotten link means no CSS, exactly as on a real website.
 * - Images are referenced by short name (`cat.jpg`) and point at the task's
 *   ImageKit URLs. Students can't use any other image or upload their own.
 */

/** Where task images live; set NEXT_PUBLIC_CODE_ASSET_URL_PREFIX to the Kalami ImageKit endpoint. */
export const ASSET_URL_PREFIX = process.env.NEXT_PUBLIC_CODE_ASSET_URL_PREFIX ?? "https://ik.imagekit.io/";

const REMOVED_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base"]);
const URL_ATTRIBUTES = ["src", "href", "poster"];
/** New elements are made through the adapter, in the HTML namespace, so the serializer treats them as HTML. */
const HTML_NS = html.NS.HTML;

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

/** `cat.jpg 2x, dog.jpg 400w`: each candidate's URL is a short name or stays as it is. */
function rewriteSrcset(srcset: string, assets: Map<string, string>): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const [ref, ...descriptors] = candidate.trim().split(/\s+/);
      const url = assets.get(normalizeRef(ref ?? ""));
      return [url ?? ref, ...descriptors].join(" ");
    })
    .join(", ");
}

function isStylesheet(rel: string | undefined): boolean {
  return /(^|\s)stylesheet(\s|$)/i.test(rel ?? "");
}

export function buildPreviewHtml(files: CodeFile[], assets: SandboxAsset[]): string {
  const index = files.find((f) => f.name === "index.html")?.content ?? "";
  const sheets = new Map(files.filter((f) => f.name.endsWith(".css")).map((f) => [f.name, f.content]));
  const assetUrls = new Map(assets.map((a) => [a.name, a.url]));

  const document = parse(index, { treeAdapter: adapter }) as unknown as Document;
  for (const element of findAll(() => true, document.children)) {
    const name = element.name.toLowerCase();
    if (REMOVED_TAGS.has(name)) {
      removeElement(element);
      continue;
    }
    // parse5 has already decoded entities, so "&#114;efresh" reads "refresh" here.
    if (name === "meta" && /^\s*refresh\s*$/i.test(element.attribs["http-equiv"] ?? "")) {
      removeElement(element);
      continue;
    }
    if (name === "link" && isStylesheet(element.attribs.rel)) {
      const css = sheets.get(normalizeRef(element.attribs.href ?? ""));
      if (css !== undefined) {
        const style = adapter.createElement("style", HTML_NS, []);
        adapter.insertText(style, escapeStyle(rewriteCssUrls(css, assetUrls)));
        replaceElement(element, style);
        continue;
      }
    }
    if (name === "style") {
      for (const child of element.children) {
        if (child instanceof Text) child.data = escapeStyle(rewriteCssUrls(child.data, assetUrls));
      }
    }
    for (const attribute of URL_ATTRIBUTES) {
      const value = element.attribs[attribute];
      if (value === undefined) continue;
      const url = assetUrls.get(normalizeRef(value));
      if (url !== undefined) element.attribs[attribute] = url;
    }
    if (element.attribs.srcset !== undefined) {
      element.attribs.srcset = rewriteSrcset(element.attribs.srcset, assetUrls);
    }
    if (element.attribs.style !== undefined) {
      element.attribs.style = rewriteCssUrls(element.attribs.style, assetUrls);
    }
  }

  // parse5 always builds <html><head>…</head><body>…</body></html>; the policy goes first in the real head.
  let head = findOne((element) => element.name === "head", document.children, true);
  if (head === null) {
    head = adapter.createElement("head", HTML_NS, []);
    const html = findOne((element) => element.name === "html", document.children, true);
    if (html !== null) prependChild(html, head);
    else prependChild(document, head);
  }
  const meta = adapter.createElement("meta", HTML_NS, [
    { name: "http-equiv", value: "Content-Security-Policy" },
    { name: "content", value: cspFor(ASSET_URL_PREFIX) },
  ]);
  prependChild(head, meta);

  return serialize(document, { treeAdapter: adapter });
}
