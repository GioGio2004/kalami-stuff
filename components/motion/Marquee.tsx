import { Sparkle } from "@/components/ui/icons";

/** An endless ticker of short phrases. Pure CSS, so it needs no JavaScript to run. */
export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  const row = (hidden: boolean) => (
    <ul
      aria-hidden={hidden}
      className="flex shrink-0 animate-marquee items-center gap-8 pr-8 group-hover:[animation-play-state:paused]"
    >
      {items.map((item) => (
        <li key={item} className="flex items-center gap-8 whitespace-nowrap">
          {item}
          <Sparkle className="size-4 shrink-0 text-highlighter-deep" />
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className={`group flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] ${className}`}
    >
      {row(false)}
      {row(true)}
    </div>
  );
}
