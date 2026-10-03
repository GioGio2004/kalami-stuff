/**
 * Where students belong. Set NEXT_PUBLIC_STUDENT_APP_URL per environment; it is
 * baked in at build time, so a production build without it still points at the
 * real student app instead of someone's localhost.
 */
export const STUDENT_APP_URL =
  process.env.NEXT_PUBLIC_STUDENT_APP_URL ??
  (process.env.NODE_ENV === "production" ? "https://app.kalami.space" : "http://localhost:3100");
