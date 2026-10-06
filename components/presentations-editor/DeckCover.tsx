import { THEMES } from "@/components/presentations/themes";
import type { DeckTheme } from "@/lib/presentation";

/**
 * A deck's cover in miniature, in its theme: the title on the theme's
 * background, a glow and the accent mark. What people see of it first (an
 * imported file, a shared link). Decorative: the title is always written out
 * next to it.
 */
export function DeckCover({ theme, title, className = "w-36 ring-1 ring-ink/10" }: { theme: DeckTheme; title: string; className?: string }) {
  const t = THEMES[theme];
  return (
    <span
      aria-hidden="true"
      className={`relative flex aspect-video shrink-0 flex-col justify-end overflow-hidden rounded-xl p-2.5 ${className}`}
      style={{ background: t.bg, color: t.fg }}
    >
      <span className="absolute -right-6 -top-8 size-20 rounded-full" style={{ background: t.glow[0] }} />
      <span className="relative line-clamp-2 text-[13px] font-semibold leading-tight" style={{ fontFamily: t.display }}>
        {title}
      </span>
      <span className="relative mt-1.5 h-1 w-10 rounded-full" style={{ background: t.markBg }} />
    </span>
  );
}
