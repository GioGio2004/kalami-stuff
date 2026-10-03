import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "USER_NOT_FOUND"
  | "MISSING_EMAIL_CLAIM"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "EXPIRED";

/**
 * Errors the apps can show to people. ConvexError data survives to the client
 * in production (plain Error messages are redacted), so clients read
 * `error.data.message` for display and `error.data.code` for logic.
 */
export function appError(code: AppErrorCode, message: string) {
  return new ConvexError({ code, message });
}
