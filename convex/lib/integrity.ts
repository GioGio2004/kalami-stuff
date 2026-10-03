import type { IntegrityCounts } from "./validators";

/**
 * Integrity counters → a score and a colour (KALAMI.md §6.4). The colour is
 * advice for the lecturer, never a verdict.
 */

export const NO_COUNTS: IntegrityCounts = { pasteBlocked: 0, dropBlocked: 0, largeInserts: 0 };

const KEYS = [
  "pasteBlocked",
  "dropBlocked",
  "largeInserts",
  "tabSwitches",
  "awayMs",
  "fullscreenExits",
  "copyBlocked",
  "shortcutsBlocked",
  "multiTab",
  "resizes",
] as const;

// One report can't add more than this, so a broken or hostile client can't flood the counters.
const MAX_DELTA: Record<(typeof KEYS)[number], number> = {
  pasteBlocked: 1000,
  dropBlocked: 1000,
  largeInserts: 1000,
  tabSwitches: 1000,
  awayMs: 6 * 60 * 60 * 1000,
  fullscreenExits: 1000,
  copyBlocked: 1000,
  shortcutsBlocked: 1000,
  multiTab: 1000,
  resizes: 1000,
};

export function addCounts(current: IntegrityCounts, delta: Partial<IntegrityCounts>): IntegrityCounts {
  const next: IntegrityCounts = { ...current };
  for (const key of KEYS) {
    const add = delta[key];
    if (add === undefined || !Number.isFinite(add) || add <= 0) continue;
    next[key] = (current[key] ?? 0) + Math.min(MAX_DELTA[key], Math.floor(add));
  }
  return next;
}

export function hasCounts(delta: Partial<IntegrityCounts> | undefined): boolean {
  return delta !== undefined && KEYS.some((key) => (delta[key] ?? 0) > 0);
}

export function integrityScore(c: IntegrityCounts): number {
  return (
    3 * (c.fullscreenExits ?? 0) +
    2 * (c.tabSwitches ?? 0) +
    Math.floor((c.awayMs ?? 0) / 10_000) +
    4 * c.largeInserts +
    c.pasteBlocked +
    c.dropBlocked +
    5 * (c.multiTab ?? 0) +
    (c.copyBlocked ?? 0) +
    (c.shortcutsBlocked ?? 0)
  );
}

export function integrityColor(score: number): "green" | "yellow" | "red" {
  return score <= 5 ? "green" : score <= 15 ? "yellow" : "red";
}
