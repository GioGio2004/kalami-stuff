import type { CSSProperties } from "react";
import type { DeckTheme } from "@/lib/presentation";

/**
 * The five curated looks. A theme decides every colour, typeface and texture
 * of a deck; slides only say what they are. Values are written out (not
 * Tailwind tokens) because a deck must look the same in both apps and inside
 * any page, and Tailwind only emits the token variables a page happens to use.
 *
 * `mark` is how **accent** words are drawn: a hand-drawn underline
 * (scribble), a highlighter block behind the words (marker), or a chalk circle
 * around them (chalk). Everything is fed to the player as CSS variables.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export type ThemeTokens = {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  surfaceLine: string;
  /** Accent-coloured text and strokes on the normal background (numbers, arrows, accent words). */
  strong: string;
  /** What draws the accent marks: a colour or a gradient. */
  markBg: string;
  mark: "scribble" | "marker" | "chalk";
  /** A slide with tone "accent": its fill (a colour or a gradient) and the text on it. */
  accentBg: string;
  accentFg: string;
  accentMuted: string;
  accentLine: string;
  codeBg: string;
  /** The highlight in a code window, which is dark in every theme. */
  codeAccent: string;
  glow: [string, string, string];
  pattern: "none" | "dots" | "grid" | "chalk";
  grain: number;
  grainBlend: "overlay" | "multiply" | "soft-light";
  display: string;
  displayWeight: number;
  displayScale: number;
  tracking: string;
};

const SANS = "var(--font-geist-sans), var(--font-georgian), ui-sans-serif, system-ui, sans-serif";
const MONO = "var(--font-geist-mono), var(--font-georgian), ui-monospace, monospace";
const HAND = "var(--font-caveat), var(--font-georgian), cursive";

export const THEMES: Record<DeckTheme, ThemeTokens> = {
  ink: {
    dark: true,
    bg: "#0c0c0b",
    fg: "#f5f5ef",
    muted: "rgba(245, 245, 239, 0.56)",
    line: "rgba(245, 245, 239, 0.14)",
    surface: "rgba(245, 245, 239, 0.05)",
    surfaceLine: "rgba(245, 245, 239, 0.13)",
    strong: "#dcf35a",
    markBg: "#dcf35a",
    mark: "scribble",
    accentBg: "#dcf35a",
    accentFg: "#121212",
    accentMuted: "rgba(18, 18, 18, 0.62)",
    accentLine: "rgba(18, 18, 18, 0.18)",
    codeBg: "#151514",
    codeAccent: "#dcf35a",
    glow: ["rgba(220, 243, 90, 0.20)", "rgba(255, 255, 255, 0.07)", "rgba(220, 243, 90, 0.09)"],
    pattern: "grid",
    grain: 0.1,
    grainBlend: "overlay",
    display: SANS,
    displayWeight: 640,
    displayScale: 1,
    tracking: "-0.045em",
  },
  paper: {
    dark: false,
    bg: "#f7f6f0",
    fg: "#141414",
    muted: "rgba(20, 20, 20, 0.58)",
    line: "rgba(20, 20, 20, 0.12)",
    surface: "#ffffff",
    surfaceLine: "rgba(20, 20, 20, 0.1)",
    strong: "#141414",
    markBg: "#dcf35a",
    mark: "marker",
    accentBg: "#dcf35a",
    accentFg: "#141414",
    accentMuted: "rgba(20, 20, 20, 0.62)",
    accentLine: "rgba(20, 20, 20, 0.16)",
    codeBg: "#1c1c1a",
    codeAccent: "#dcf35a",
    glow: ["rgba(220, 243, 90, 0.55)", "rgba(238, 74, 46, 0.09)", "rgba(220, 243, 90, 0.28)"],
    pattern: "dots",
    grain: 0.05,
    grainBlend: "multiply",
    display: SANS,
    displayWeight: 640,
    displayScale: 1,
    tracking: "-0.045em",
  },
  aurora: {
    dark: true,
    bg: "#06071a",
    fg: "#f3f1ff",
    muted: "rgba(243, 241, 255, 0.6)",
    line: "rgba(243, 241, 255, 0.14)",
    surface: "rgba(255, 255, 255, 0.06)",
    surfaceLine: "rgba(255, 255, 255, 0.14)",
    strong: "#9ef0ff",
    markBg: "linear-gradient(90deg, #7cf7ff, #b69cff 55%, #ff8bd1)",
    mark: "scribble",
    accentBg: "linear-gradient(135deg, #4f46e5 0%, #8b5cf6 48%, #ec4899 100%)",
    accentFg: "#ffffff",
    accentMuted: "rgba(255, 255, 255, 0.74)",
    accentLine: "rgba(255, 255, 255, 0.24)",
    codeBg: "rgba(9, 9, 30, 0.78)",
    codeAccent: "#7cf7ff",
    glow: ["rgba(109, 90, 255, 0.55)", "rgba(34, 211, 238, 0.36)", "rgba(244, 114, 182, 0.32)"],
    pattern: "none",
    grain: 0.09,
    grainBlend: "overlay",
    display: SANS,
    displayWeight: 600,
    displayScale: 1,
    tracking: "-0.04em",
  },
  ember: {
    dark: false,
    bg: "#fff2e5",
    fg: "#22110a",
    muted: "rgba(34, 17, 10, 0.6)",
    line: "rgba(34, 17, 10, 0.13)",
    surface: "rgba(255, 255, 255, 0.62)",
    surfaceLine: "rgba(34, 17, 10, 0.1)",
    strong: "#e5450c",
    markBg: "#ff5a1f",
    mark: "scribble",
    accentBg: "#ff5a1f",
    accentFg: "#fff4ea",
    accentMuted: "rgba(255, 244, 234, 0.8)",
    accentLine: "rgba(255, 244, 234, 0.3)",
    codeBg: "#26120a",
    codeAccent: "#ff8a4c",
    glow: ["rgba(255, 90, 31, 0.3)", "rgba(255, 176, 0, 0.32)", "rgba(244, 63, 94, 0.15)"],
    pattern: "none",
    grain: 0.06,
    grainBlend: "multiply",
    display: SANS,
    displayWeight: 660,
    displayScale: 1,
    tracking: "-0.05em",
  },
  chalk: {
    dark: true,
    bg: "#1b2822",
    fg: "#f1f0e4",
    muted: "rgba(241, 240, 228, 0.6)",
    line: "rgba(241, 240, 228, 0.2)",
    surface: "rgba(241, 240, 228, 0.045)",
    surfaceLine: "rgba(241, 240, 228, 0.3)",
    strong: "#ffe46b",
    markBg: "#ffe46b",
    mark: "chalk",
    accentBg: "#ffe46b",
    accentFg: "#1b2822",
    accentMuted: "rgba(27, 40, 34, 0.7)",
    accentLine: "rgba(27, 40, 34, 0.22)",
    codeBg: "rgba(0, 0, 0, 0.26)",
    codeAccent: "#ffe46b",
    glow: ["rgba(255, 255, 255, 0.07)", "rgba(255, 228, 107, 0.06)", "rgba(255, 255, 255, 0.05)"],
    pattern: "chalk",
    grain: 0.16,
    grainBlend: "overlay",
    display: HAND,
    displayWeight: 700,
    displayScale: 1.24,
    tracking: "0em",
  },
};

/** The theme as the CSS variables the deck's stylesheet reads. */
export function themeStyle(theme: DeckTheme): CSSProperties {
  const t = THEMES[theme];
  return {
    "--deck-bg": t.bg,
    "--deck-fg": t.fg,
    "--deck-muted": t.muted,
    "--deck-line": t.line,
    "--deck-surface": t.surface,
    "--deck-surface-line": t.surfaceLine,
    "--deck-strong": t.strong,
    "--deck-mark-bg": t.markBg,
    "--deck-accent-bg": t.accentBg,
    "--deck-accent-fg": t.accentFg,
    "--deck-accent-muted": t.accentMuted,
    "--deck-accent-line": t.accentLine,
    "--deck-code-bg": t.codeBg,
    "--deck-code-accent": t.codeAccent,
    "--deck-glow-a": t.glow[0],
    "--deck-glow-b": t.glow[1],
    "--deck-glow-c": t.glow[2],
    "--deck-grain": String(t.grain),
    "--deck-grain-blend": t.grainBlend,
    "--deck-display": t.display,
    "--deck-display-weight": String(t.displayWeight),
    "--deck-display-scale": String(t.displayScale),
    "--deck-tracking": t.tracking,
    "--deck-sans": SANS,
    "--deck-mono": MONO,
    "--deck-hand": HAND,
  } as CSSProperties;
}
