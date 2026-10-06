import type { ReactNode } from "react";
import type { TokenKind } from "./highlight";

// The pieces of a code window that lesson blocks and animated scenes share:
// token colours, the window bar, and the file name on it.
// This folder is copied into the student app by scripts/sync-student.mjs; edit it here.

export const TOKEN_CLASS: Record<TokenKind, string> = {
  text: "text-code-text",
  tag: "text-code-tag",
  attr: "text-code-attr",
  string: "text-code-string",
  comment: "text-code-comment italic",
  keyword: "text-code-keyword",
  number: "text-code-number",
  property: "text-code-property",
  selector: "text-code-selector",
  value: "text-code-value",
  function: "text-code-function",
  punct: "text-code-punct",
};

/** The file name on the window bar: what the student would save this as. */
export function fileNameFor(language: string): string {
  switch (language.trim().toLowerCase()) {
    case "html":
      return "index.html";
    case "css":
      return "style.css";
    case "js":
    case "javascript":
      return "script.js";
    case "ts":
    case "typescript":
      return "script.ts";
    case "json":
      return "data.json";
    case "python":
    case "py":
      return "main.py";
    default:
      return language.trim() === "" ? "code" : language.trim();
  }
}

/** The bar on top of a code or result window: three dots, a name, and anything on the right. */
export function WindowBar({ tone, title, live, aside }: { tone: "dark" | "light"; title: string; live?: boolean; aside?: ReactNode }) {
  const dark = tone === "dark";
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${dark ? "border-b border-paper/10" : "border-b border-line bg-paper"}`}>
      <span aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className={`size-2.5 rounded-full ${dark ? "bg-paper/20" : "bg-ink/15"}`} />
        ))}
      </span>
      <span className={`font-mono text-[0.72em] tracking-[0.08em] ${dark ? "text-paper/60" : "text-graphite"}`}>{title}</span>
      {live && (
        <span className="inline-flex items-center gap-1.5 text-[0.72em] uppercase tracking-[0.12em] text-graphite">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
          live
        </span>
      )}
      {aside && <span className="ml-auto">{aside}</span>}
    </div>
  );
}
