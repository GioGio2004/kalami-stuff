"use client";

import type { ReactNode } from "react";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { Button } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/form";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { ListStatus } from "@/components/admin/types";

// Small pieces every admin page is built from: the header, stat tiles, cards,
// a status bar, avatars and the paginated-list footer.

export function PanelHeader({
  note,
  title,
  description,
  children,
}: {
  /** The handwritten line above the title. */
  note: string;
  title: string;
  description?: ReactNode;
  /** Actions and filters, on the right. */
  children?: ReactNode;
}) {
  return (
    <header className="rounded-[2.5rem] bg-panel px-5 pb-6 pt-8 sm:px-8 sm:pb-7 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">{note}</p>
          <AnimatedHeading as="h1" className="mt-3 text-4xl font-medium leading-[0.98] tracking-[-0.04em] sm:text-5xl">
            {title}
          </AnimatedHeading>
          {description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-graphite">{description}</p>}
        </div>
        {children && <div className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</div>}
      </div>
    </header>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`min-w-0 rounded-[2rem] bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function CardTitle({ children, count, aside }: { children: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-xl font-medium tracking-tight">{children}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-panel px-2.5 py-0.5 text-sm tabular-nums text-graphite">{count}</span>
      )}
      {aside && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

export function formatCount(value: number, capped = false): string {
  return `${new Intl.NumberFormat("en-GB").format(value)}${capped ? "+" : ""}`;
}

/** One number with its label: the overview's tiles. */
export function StatTile({
  label,
  value,
  note,
  tone = "card",
}: {
  label: string;
  value: number | string;
  note?: ReactNode;
  tone?: "card" | "ink" | "lime";
}) {
  const tones = {
    card: "bg-card",
    ink: "bg-ink text-paper",
    lime: "bg-highlighter",
  } as const;
  return (
    <div className={`min-w-0 rounded-[1.6rem] p-5 ${tones[tone]}`}>
      <p className={`text-sm ${tone === "ink" ? "text-paper/70" : "text-graphite"}`}>{label}</p>
      <p className="mt-1.5 truncate text-4xl font-medium tracking-[-0.04em] tabular-nums">
        {typeof value === "number" ? formatCount(value) : value}
      </p>
      {note && <p className={`mt-1 text-xs ${tone === "ink" ? "text-paper/60" : "text-graphite"}`}>{note}</p>}
    </div>
  );
}

export type Segment = { label: string; value: number; className: string };

/**
 * How a total splits (drafts / published / archived): one bar, labelled
 * underneath, so a colour never has to be read on its own.
 */
export function StatusBar({ segments, empty = "Nothing yet" }: { segments: Segment[]; empty?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      {total === 0 ? (
        <p className="font-hand text-[1.4rem] leading-none text-graphite">{empty}</p>
      ) : (
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.label} className={`h-full rounded-full ${s.className}`} style={{ flexGrow: s.value, flexBasis: 6 }} />
            ))}
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 rounded-full ${s.className}`} />
            <span className="text-graphite">{s.label}</span>
            <span className="font-medium tabular-nums">{formatCount(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Initials in a circle, or the picture when there is one. */
export function Avatar({
  name,
  email,
  src,
  size = "md",
}: {
  name: string;
  email: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" } as const;
  const initials = (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from Clerk's CDN with their own sizing.
    return <img src={src} alt="" className={`${sizes[size]} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span className={`grid ${sizes[size]} shrink-0 place-items-center rounded-full bg-panel font-semibold`} aria-hidden>
      {initials}
    </span>
  );
}

export function SearchBox({
  id,
  label,
  placeholder,
  value,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <TextInput
        id={id}
        type="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** The foot of a paginated list: how many are shown, and the button for the next page. */
export function ListFooter({
  shown,
  noun,
  status,
  onLoadMore,
}: {
  shown: number;
  noun: string;
  status: ListStatus;
  onLoadMore: () => void;
}) {
  if (status === "loading") {
    return (
      <div className="flex justify-center py-8">
        <WritingDots label={`Loading ${noun}`} />
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-graphite">
      <span>
        {status === "done" ? "All" : "Showing"} {formatCount(shown)} {noun}
      </span>
      {status !== "done" && (
        <Button size="sm" variant="outline" disabled={status === "loading-more"} onClick={onLoadMore}>
          {status === "loading-more" ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center font-hand text-[1.5rem] leading-none text-graphite">
      {children}
    </p>
  );
}

/** A label/value pair in a details list. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-graphite">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px]">{children}</dd>
    </div>
  );
}
