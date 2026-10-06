/**
 * A number as a slide shows it. Always en-US grouping, so the server and the
 * browser render the same text (a different default locale would break
 * hydration) and a counter never changes format halfway.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "01", "02" … for numbered items. */
export function pad(n: number): string {
  return String(n).padStart(2, "0");
}
