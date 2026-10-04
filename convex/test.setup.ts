/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import resend from "@convex-dev/resend/test";
import { convexTest, type TestConvex } from "convex-test";
import type { UserIdentity } from "convex/server";
import { expect, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import schema from "./schema";

/** Every backend module, for convex-test. (The Convex CLI skips this file: it is test setup, not a function.) */
export const modules = import.meta.glob("./**/*.ts");

export type TestBackend = TestConvex<typeof schema>;

/** A fresh in-memory backend with the two components the functions depend on. */
export function createTest(): TestBackend {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  resend.register(t);
  return t;
}

export const ISSUER = "https://test.clerk.accounts.dev";

export function person(name: string): Partial<UserIdentity> {
  return {
    issuer: ISSUER,
    subject: name,
    tokenIdentifier: `${ISSUER}|${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    givenName: name,
  } as Partial<UserIdentity>;
}

/** Runs everything the last mutations scheduled (fan-outs, grading, email delivery). */
export async function settle(t: TestBackend) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

export async function expectAppError(call: Promise<unknown>, code: string) {
  try {
    await call;
  } catch (error) {
    expect((error as { data?: { code?: string } }).data?.code).toBe(code);
    return;
  }
  throw new Error(`Expected a ${code} error, but the call succeeded`);
}

/**
 * A lecturer (nino) with a published course that two students (ana, giorgi)
 * joined, plus a student (maka) who didn't, and a super admin.
 */
export async function seed() {
  const t = createTest();
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const universityId = await admin.mutation(api.universities.create, { nameKa: "გორი", nameEn: "Gori State", slug: "gori" });

  const nino = t.withIdentity(person("nino"));
  const ninoId = await nino.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId: ninoId, role: "lecturer", universityId });
  });

  async function student(name: string) {
    const identity = t.withIdentity(person(name));
    await identity.mutation(api.users.store, {});
    await identity.mutation(api.users.completeStudentOnboarding, {
      firstName: name,
      lastName: "S",
      universityId,
      faculty: "CS",
      group: "CS-1",
      year: 1,
      locale: "ka",
      honestyVersion: HONESTY_NOTICE.version,
    });
    return identity;
  }
  const ana = await student("ana");
  const giorgi = await student("giorgi");
  const maka = await student("maka");

  const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
  await nino.mutation(api.courses.update, { courseId, status: "published" });
  const { joinCode } = await nino.query(api.courses.get, { courseId });
  await ana.mutation(api.learn.join, { code: joinCode });
  await giorgi.mutation(api.learn.join, { code: joinCode });

  /** A draft quiz with one short-answer question; `settings` are applied before publishing. */
  async function quiz(title: string, settings: Record<string, unknown> = {}, publish = true) {
    const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "quiz", title });
    await nino.mutation(api.assessments.update, { assessmentId, settings });
    const [questionId] = await nino.mutation(api.questions.add, {
      assessmentId,
      questions: [{ type: "short", prompt: "What does CSS stand for?", points: 1, acceptedAnswers: ["Cascading Style Sheets"] }],
    });
    if (publish) {
      await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
      await settle(t);
    }
    return { assessmentId, questionId };
  }
  return { t, admin, nino, ana, giorgi, maka, universityId, courseId, joinCode, quiz };
}
