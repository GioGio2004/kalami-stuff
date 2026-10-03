import type { ReactNode } from "react";

export type PillTone = "panel" | "lime" | "ink" | "red" | "ok" | "paper";

const tones: Record<PillTone, string> = {
  panel: "bg-panel text-graphite",
  lime: "bg-highlighter text-ink",
  ink: "bg-ink text-paper",
  red: "bg-red-pen/10 text-red-pen",
  ok: "bg-ok/12 text-ok",
  paper: "bg-paper text-ink",
};

/** Small rounded label: statuses, kinds, settings. */
export function Pill({
  tone = "panel",
  className = "",
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function statusTone(status: "draft" | "published" | "archived"): PillTone {
  return status === "published" ? "lime" : status === "archived" ? "panel" : "paper";
}

export function statusLabel(status: "draft" | "published" | "archived"): string {
  return status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
}
