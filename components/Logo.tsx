/** A fountain-pen nib in highlighter lime on an ink tile. */
export function KalamiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9.5" fill="var(--ink)" />
      <path
        d="M10.4 6.8h11.2v4.6L16 26.2l-5.6-14.8z"
        fill="var(--highlighter)"
        stroke="var(--highlighter)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M16 16.4v8.6" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="14.6" r="1.9" fill="var(--ink)" />
    </svg>
  );
}

/** `compact` drops the wordmark on phones, where a header needs the room for its links. */
export function Logo({ tone = "ink", compact = false }: { tone?: "ink" | "paper"; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <KalamiMark className="size-9 shrink-0" />
      <span className={`flex-col leading-none ${compact ? "hidden sm:flex" : "flex"}`}>
        <span
          className={`text-[1.3rem] font-semibold tracking-[-0.03em] ${tone === "paper" ? "text-paper" : "text-ink"}`}
        >
          Kalami
        </span>
        <span className={`mt-0.5 text-[11px] ${tone === "paper" ? "text-paper/60" : "text-graphite"}`}>
          კალამი
        </span>
      </span>
    </span>
  );
}
