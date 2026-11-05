"use client";

import { useEffect, useRef, useState } from "react";
import { buildPreviewHtml, previewCss } from "./buildPreview";
import type { CodeFile, SandboxAsset } from "./types";

/**
 * The student's page, live. A sandboxed iframe with no `allow-scripts`: HTML
 * and CSS render, nothing can run. `allow-same-origin` (without scripts) only
 * lets this component keep the scroll position, stop links from leaving, and
 * swap a stylesheet's CSS in place.
 *
 * Because of that flag the page's requests are first-party. They are limited
 * to the task's images and Google Fonts by the policy buildPreview.ts puts
 * first in <head>; keep it that way, and never give either app a GET route
 * that does something because the browser sent a cookie.
 *
 * Typing in a .css file doesn't reload the page: the new CSS goes straight
 * into its <style>, so nothing flashes, the scroll stays and animations that
 * didn't change keep running. HTML changes (and the refresh button) rebuild it.
 */

/** Everything but the CSS files' content: when this is unchanged, a CSS edit can be applied in place. */
function structureOf(files: CodeFile[], assets: SandboxAsset[]): string {
  return JSON.stringify([
    files.map((f) => (f.name.endsWith(".css") ? f.name : [f.name, f.content])),
    assets.map((a) => [a.name, a.url]),
  ]);
}

export function Preview({
  files,
  assets,
  width,
  refreshKey = 0,
}: {
  files: CodeFile[];
  assets: SandboxAsset[];
  /** Fixed width in px (phone view); fills the panel when undefined. */
  width?: number;
  /** Bump to rebuild right away instead of after the typing pause. */
  refreshKey?: number;
}) {
  const [doc, setDoc] = useState(() => buildPreviewHtml(files, assets));
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef({ x: 0, y: 0 });
  const lastRefresh = useRef(refreshKey);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const now = refreshKey !== lastRefresh.current;
    lastRefresh.current = refreshKey;
    const timer = setTimeout(
      () => {
        const structure = structureOf(files, assets);
        shown.current ??= structure;
        const page = frame.current?.contentDocument;
        if (!now && structure === shown.current && page) {
          for (const style of page.querySelectorAll<HTMLStyleElement>("style[data-kalami-sheet]")) {
            const css = previewCss(style.dataset.kalamiSheet ?? "", files, assets);
            if (css !== undefined && style.textContent !== css) style.textContent = css;
          }
          return;
        }
        shown.current = structure;
        setDoc(buildPreviewHtml(files, assets));
      },
      now ? 0 : 300,
    );
    return () => clearTimeout(timer);
  }, [files, assets, refreshKey]);

  function onLoad() {
    const win = frame.current?.contentWindow;
    const page = frame.current?.contentDocument;
    if (!win || !page) return;
    win.scrollTo(scroll.current.x, scroll.current.y);
    win.addEventListener("scroll", () => {
      scroll.current = { x: win.scrollX, y: win.scrollY };
    });
    // No link may navigate the preview: a srcdoc page resolves even "#gallery" against the app's own
    // address, so following it would load Kalami inside the preview. In-page anchors scroll instead.
    page.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href], area[href]");
      if (link === null || link === undefined) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#")) return;
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // A broken escape: look the id up as written.
      }
      const target = id === "" ? null : (page.getElementById(id) ?? page.getElementsByName(id)[0] ?? null);
      if (target !== null) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (id === "" || id === "top") {
        win.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 justify-center overflow-auto bg-panel">
      <iframe
        ref={frame}
        title="Preview of your page"
        sandbox="allow-same-origin"
        srcDoc={doc}
        onLoad={onLoad}
        className="h-full shrink-0 bg-white"
        style={{ width: width === undefined ? "100%" : `${width}px` }}
      />
    </div>
  );
}
