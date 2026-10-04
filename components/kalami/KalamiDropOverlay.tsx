"use client";

import { useEffect, useRef, useState } from "react";
import { KalamiFileIcon } from "./KalamiFile";

/**
 * Drop a .kalami file anywhere on the page: while a file is dragged over the
 * window, the page shows a big drop target; dropping hands the file to
 * `onFile`. Ignores drags that carry no files (text, links).
 */
export function KalamiDropOverlay({ onFile }: { onFile: (file: File) => void }) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  }, [onFile]);

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setActive(true);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setActive(false);
      const file = event.dataTransfer?.files[0];
      if (file) handler.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink/55 p-6 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-[2.5rem] border-2 border-dashed border-highlighter bg-paper px-10 py-12 text-center shadow-2xl">
        <KalamiFileIcon className="h-28 w-auto -rotate-6 motion-safe:animate-bounce" decorative />
        <p className="text-2xl font-medium tracking-tight">Drop your .kalami file</p>
        <p className="max-w-xs text-sm text-graphite">Kalami shows what&apos;s inside before anything is created.</p>
      </div>
    </div>
  );
}
