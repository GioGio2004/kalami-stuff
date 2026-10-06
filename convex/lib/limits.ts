import { HOUR, MINUTE, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";

/**
 * Per-person limits on what costs something: a token bucket refills at `rate`
 * per `period` and holds at most `capacity`, so honest bursts (a student
 * clicking through ten choices) pass and a runaway client doesn't. Keys are
 * always the signed-in user, never an IP: a whole classroom shares one IP.
 */
export const LIMITS = {
  // Students
  join: { kind: "token bucket", rate: 30, period: 15 * MINUTE, capacity: 10 },
  startAttempt: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 5 },
  saveAnswer: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 30 },
  saveCode: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 15 },
  integrity: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 6 },
  submit: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 3 },
  // The contact card: new conversations and replies (staff replies count too).
  startConversation: { kind: "token bucket", rate: 6, period: HOUR, capacity: 4 },
  sendMessage: { kind: "token bucket", rate: 30, period: 10 * MINUTE, capacity: 10 },
  emailPreference: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 5 },
  // Push notifications: turning a device on, and the "send me a test" button.
  pushSubscribe: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  pushTest: { kind: "token bucket", rate: 6, period: HOUR, capacity: 3 },
  // Staff
  createCourse: { kind: "token bucket", rate: 10, period: HOUR, capacity: 10 },
  createAssessment: { kind: "token bucket", rate: 30, period: HOUR, capacity: 20 },
  addQuestions: { kind: "token bucket", rate: 20, period: 10 * MINUTE, capacity: 10 },
  grade: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 30 },
  invite: { kind: "fixed window", rate: 50, period: 24 * HOUR },
  // The notification center: messages sent per admin.
  broadcast: { kind: "fixed window", rate: 30, period: HOUR },
  createGroup: { kind: "token bucket", rate: 20, period: HOUR, capacity: 20 },
  // One unit per email address, so a class of 40 is one paste.
  groupInvite: { kind: "token bucket", rate: 300, period: 24 * HOUR, capacity: 200 },
  // Google Drive work (folders, sharing), per lecturer.
  drive: { kind: "token bucket", rate: 60, period: 10 * MINUTE, capacity: 30 },
  // AI agents, per lecturer, across every writing tool
  agent: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 20 },
} as const satisfies Record<string, RateLimitConfig>;

export type LimitName = keyof typeof LIMITS;

const limiter = new RateLimiter(components.rateLimiter, LIMITS);

/** Throws RATE_LIMITED (with `retryAfterMs`) once `key` has used up its budget for `name`. */
export async function enforceLimit(ctx: MutationCtx, name: LimitName, key: string, count = 1): Promise<void> {
  const { ok, retryAfter } = await limiter.limit(ctx, name, { key, count });
  if (!ok) {
    const seconds = Math.max(1, Math.ceil(retryAfter / 1000));
    throw appError("RATE_LIMITED", `Too many requests in a short time. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`, {
      retryAfterMs: Math.ceil(retryAfter),
    });
  }
}
