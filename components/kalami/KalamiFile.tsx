"use client";

import { KALAMI_MIME } from "@/convex/lib/kalami";

/**
 * The .kalami file as Kalami draws it: an ink page with a lime folded corner,
 * the pen nib, and the extension on a label. Used wherever a course file
 * appears (export, the import preview, the drop zone). `decorative`: inside a
 * button or next to text that already says it, so screen readers skip it.
 */
export function KalamiFileIcon({
  className = "",
  label = ".kalami",
  decorative = false,
}: {
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 80"
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `${label} file` })}
    >
      <path d="M8 2h34l20 20v50a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" fill="var(--ink)" />
      <path d="M42 2v14a6 6 0 0 0 6 6h14z" fill="var(--highlighter)" />
      <path
        d="M24.4 22h15.2v6.2L32 48.2l-7.6-20z"
        fill="var(--highlighter)"
        stroke="var(--highlighter)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M32 35v12" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="32.6" r="2.5" fill="var(--ink)" />
      <rect x="10" y="57" width="44" height="13" rx="6.5" fill="var(--highlighter)" />
      <text
        x="32"
        y="66.4"
        textAnchor="middle"
        fontSize="8.4"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
        fill="var(--ink)"
      >
        {label}
      </text>
    </svg>
  );
}

/** Saves a course file the browser built from Kalami's export. Nothing is uploaded. */
export function downloadKalami(fileName: string, content: string) {
  const blob = new Blob([content], { type: KALAMI_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
