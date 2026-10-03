"use client";

import { useEffect, useRef, useState } from "react";
import { buildPreviewHtml } from "./buildPreview";
import type { CodeFile, SandboxAsset } from "./types";

/**
 * The student's page, live. A sandboxed iframe with no `allow-scripts`: HTML
 * and CSS render, nothing can run. `allow-same-origin` (without scripts) only
 * lets this component keep the scroll position and stop links from leaving.
 */
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

  useEffect(() => {
    const now = refreshKey !== lastRefresh.current;
    lastRefresh.current = refreshKey;
    const timer = setTimeout(() => setDoc(buildPreviewHtml(files, assets)), now ? 0 : 300);
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
    // Links would navigate the preview away from the student's page. In-page anchors still work.
    page.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (link !== null && link !== undefined && !link.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
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
