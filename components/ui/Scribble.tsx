import type { ReactNode } from "react";
import { DrawPath } from "@/components/motion/primitives";

/** A highlighter loop drawn around a word, like circling it in a notebook. */
export function Scribble({ children, delay = 0.2 }: { children: ReactNode; delay?: number }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <span className="relative z-10">{children}</span>
      <svg
        aria-hidden
        viewBox="0 0 300 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -left-[8%] -top-[18%] h-[136%] w-[116%] overflow-visible"
      >
        <DrawPath
          delay={delay}
          duration={1.3}
          d="M238 15C178 2 74 6 30 27 3 40 4 68 36 83c44 19 170 18 228-2 30-11 38-36 14-54C252 10 184 3 118 11"
          stroke="var(--highlighter-deep)"
          strokeWidth={3.5}
        />
      </svg>
    </span>
  );
}

/** A wobbly hand-drawn underline. */
export function ScribbleUnderline({ children, delay = 0.3 }: { children: ReactNode; delay?: number }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <span className="relative z-10">{children}</span>
      <svg
        aria-hidden
        viewBox="0 0 300 24"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -bottom-[0.18em] left-0 h-[0.42em] w-full overflow-visible"
      >
        <DrawPath
          delay={delay}
          d="M4 15c40-9 82-11 126-7 38 3 74 6 112-1 18-3 36-5 54-4"
          stroke="var(--highlighter-deep)"
          strokeWidth={6}
        />
      </svg>
    </span>
  );
}

/** The circled label above Tabela-style sections ("Features", "Pricing"). */
export function CircledLabel({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block px-3 py-1 text-sm font-medium text-ink">
      {children}
      <svg
        aria-hidden
        viewBox="0 0 120 44"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <DrawPath
          delay={0.2}
          d="M96 6C70 1 28 2 12 12 0 20 3 34 22 39c26 7 70 6 88-3 12-6 10-20-6-26C90 5 66 3 44 6"
          stroke="var(--highlighter-deep)"
          strokeWidth={2}
        />
      </svg>
    </span>
  );
}
