import type { ReactNode } from "react";
import { KalamiMark } from "@/components/Logo";
import { Float } from "@/components/motion/primitives";
import { Enter } from "@/components/motion/Reveal";

/** Full-page message for gates and one-off states (wrong account, errors, sign in). */
export function StatusScreen({
  note,
  title,
  children,
}: {
  note?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Enter kind="scale" className="w-full max-w-lg rounded-[2.25rem] bg-panel p-8 sm:p-10">
        <Enter kind="pop" delay={0.15}>
          <KalamiMark className="size-11" />
        </Enter>
        {note && (
          <Enter as="p" kind="left" delay={0.3} className="mt-8 -rotate-1 font-hand text-[1.6rem] leading-none text-graphite">
            {note}
          </Enter>
        )}
        <Enter
          as="h1"
          delay={0.4}
          className={`${note ? "mt-3" : "mt-8"} text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-4xl`}
        >
          {title}
        </Enter>
        {children && (
          <Enter delay={0.55} className="mt-4 space-y-5 text-[15px] leading-relaxed text-graphite">
            {children}
          </Enter>
        )}
      </Enter>
    </main>
  );
}

/** Three dots, like someone in the middle of writing. */
export function WritingDots({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex gap-1.5 rounded-full bg-panel px-4 py-3">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-bounce rounded-full bg-ink/55"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function LoadingScreen({ label }: { label?: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24" aria-busy="true">
      <div className="flex flex-col items-center gap-5">
        <Float amplitude={7} duration={2.2}>
          <KalamiMark className="size-11" />
        </Float>
        <WritingDots label={label} />
      </div>
    </main>
  );
}
