/// <reference types="vite/client" />
import { createTest, type TestBackend } from "./test.setup";
import type { UserIdentity } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HONESTY_NOTICE } from "./lib/honestyNotice";

const ISSUER = "https://test.clerk.accounts.dev";
const HOUR = 60 * 60 * 1000;

function person(name: string): Partial<UserIdentity> {
  return {
    issuer: ISSUER,
    subject: name,
    tokenIdentifier: `${ISSUER}|${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    givenName: name,
  } as Partial<UserIdentity>;
}

type T = TestBackend;

/** Runs the batches a mutation scheduled (fan-out writes rows after the publish commits). */
async function settle(t: T) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

/** The reminder cron, then the fan-out it scheduled. */
async function runReminders(t: T): Promise<number> {
  const started = await t.mutation(internal.notifications.remindDue, {});
  await settle(t);
  return started;
}

const QUESTION = {
  type: "short" as const,
  prompt: "What does CSS stand for?",
  points: 1,
  acceptedAnswers: ["Cascading Style Sheets"],
};

/** A lecturer with a published course, two students in it, and a student elsewhere. */
async function setup() {
  const t = createTest();
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const gori = await admin.mutation(api.universities.create, { nameKa: "გორი", nameEn: "Gori State", slug: "gori" });

  const nino = t.withIdentity(person("nino"));
  const ninoId = await nino.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId: ninoId, role: "lecturer", universityId: gori });
  });

  async function student(name: string) {
    const identity = t.withIdentity(person(name));
    await identity.mutation(api.users.store, {});
    await identity.mutation(api.users.completeStudentOnboarding, {
      firstName: name,
      lastName: "S",
      universityId: gori,
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

  async function quiz(title: string, settings: Record<string, unknown> = {}) {
    const assessmentId = await nino.mutation(api.assessments.create, { courseId, kind: "quiz", title });
    await nino.mutation(api.assessments.update, { assessmentId, settings });
    await nino.mutation(api.questions.add, { assessmentId, questions: [QUESTION] });
    return assessmentId;
  }
  return { t, nino, ana, giorgi, maka, courseId, quiz };
}

describe("new work", () => {
  test("publishing tells every student in the course, once", async () => {
    const { t, nino, ana, giorgi, maka, courseId, quiz } = await setup();
    const assessmentId = await quiz("Quiz 1", { closesAt: Date.now() + 72 * HOUR });
    expect(await ana.query(api.notifications.inbox, {})).toMatchObject({ unread: 0, items: [] });

    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await settle(t);

    const inbox = await ana.query(api.notifications.inbox, {});
    expect(inbox.unread).toBe(1);
    expect(inbox.items).toMatchObject([
      {
        kind: "published",
        assessmentKind: "quiz",
        title: "Quiz 1",
        courseTitle: "Web basics",
        courseId,
        href: `/quizzes/${assessmentId}`,
        read: false,
      },
    ]);
    expect(inbox.items[0].dueAt).toBeGreaterThan(Date.now());
    expect((await giorgi.query(api.notifications.inbox, {})).unread).toBe(1);
    // Not enrolled: hears nothing.
    expect((await maka.query(api.notifications.inbox, {})).unread).toBe(0);

    // Back to draft and published again: no second notice.
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "draft" });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await settle(t);
    expect((await ana.query(api.notifications.inbox, {})).items).toHaveLength(1);
  });

  test("reading: one at a time or all at once, only your own", async () => {
    const { t, nino, ana, giorgi, quiz } = await setup();
    const first = await quiz("Quiz 1");
    const second = await quiz("Quiz 2");
    await nino.mutation(api.assessments.setStatus, { assessmentId: first, status: "published" });
    await nino.mutation(api.assessments.setStatus, { assessmentId: second, status: "published" });
    await settle(t);

    const inbox = await ana.query(api.notifications.inbox, {});
    expect(inbox.unread).toBe(2);
    // Newest first.
    expect(inbox.items.map((item) => item.title)).toEqual(["Quiz 2", "Quiz 1"]);

    const [newest] = inbox.items;
    await expect(giorgi.mutation(api.notifications.markRead, { notificationId: newest._id })).rejects.toThrow();
    await ana.mutation(api.notifications.markRead, { notificationId: newest._id });
    const after = await ana.query(api.notifications.inbox, {});
    expect(after.unread).toBe(1);
    expect(after.items.map((item) => item.read)).toEqual([true, false]);

    await ana.mutation(api.notifications.markAllRead, {});
    expect((await ana.query(api.notifications.inbox, {})).unread).toBe(0);
    // The other student's inbox is untouched.
    expect((await giorgi.query(api.notifications.inbox, {})).unread).toBe(2);
  });

  test("students are told in batches when the course is big", async () => {
    const { t, nino, courseId, quiz } = await setup();
    // Enrolments straight into the table: 250 students, two already removed.
    await t.run(async (ctx) => {
      for (let i = 0; i < 250; i++) {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: `${ISSUER}|bulk-${i}`,
          email: `bulk-${i}@example.com`,
          locale: "ka",
        });
        await ctx.db.insert("enrollments", {
          courseId,
          userId,
          status: i < 2 ? "removed" : "active",
          enrolledAt: Date.now(),
        });
      }
    });
    const assessmentId = await quiz("Big quiz");
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await settle(t);

    const run = await t.run(async (ctx) =>
      ctx.db
        .query("notificationRuns")
        .withIndex("by_assessmentId_and_kind", (q) => q.eq("assessmentId", assessmentId).eq("kind", "published"))
        .unique(),
    );
    // 248 bulk students plus ana and giorgi.
    expect(run?.sent).toBe(250);
  });
});

describe("deadline reminders", () => {
  async function publishedAgo(
    ctx: Awaited<ReturnType<typeof setup>>,
    title: string,
    hoursAgo: number,
    closesInHours: number,
  ): Promise<Id<"assessments">> {
    const now = Date.now();
    const assessmentId = await ctx.quiz(title, { closesAt: now + closesInHours * HOUR });
    await ctx.nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await settle(ctx.t);
    await ctx.t.run(async (db) => {
      await db.db.patch("assessments", assessmentId, { publishedAt: now - hoursAgo * HOUR });
    });
    return assessmentId;
  }

  test("a day before: once, and only to students who haven't submitted", async () => {
    const ctx = await setup();
    const { t, ana, giorgi } = ctx;
    const assessmentId = await publishedAgo(ctx, "Quiz 1", 48, 20);
    // Giorgi is done with it.
    await giorgi.mutation(api.learn.startAttempt, { assessmentId });
    await giorgi.mutation(api.learn.submit, { assessmentId });

    expect(await runReminders(t)).toBe(1);
    const anaInbox = await ana.query(api.notifications.inbox, {});
    expect(anaInbox.items.map((item) => item.kind)).toEqual(["due_24h", "published"]);
    expect((await giorgi.query(api.notifications.inbox, {})).items.map((item) => item.kind)).toEqual(["published"]);

    // The next run finds nothing new to send.
    expect(await runReminders(t)).toBe(0);
    expect((await ana.query(api.notifications.inbox, {})).items).toHaveLength(2);
  });

  test("the last hour gets its own reminder", async () => {
    const ctx = await setup();
    const { t, ana } = ctx;
    await publishedAgo(ctx, "Quiz 1", 48, 0.5);
    expect(await runReminders(t)).toBe(2);
    expect((await ana.query(api.notifications.inbox, {})).items.map((item) => item.kind)).toEqual([
      "due_1h",
      "due_24h",
      "published",
    ]);
  });

  test("work set shortly before it's due isn't announced twice", async () => {
    const ctx = await setup();
    const { t, ana } = ctx;
    // Published an hour ago, due in 20 hours: the "new work" notice already said when.
    await publishedAgo(ctx, "Quiz 1", 1, 20);
    expect(await runReminders(t)).toBe(0);
    expect((await ana.query(api.notifications.inbox, {})).items.map((item) => item.kind)).toEqual(["published"]);
  });

  test("nothing is sent for work that isn't closing soon, or already closed", async () => {
    const ctx = await setup();
    const { t, ana, nino } = ctx;
    await publishedAgo(ctx, "Later", 48, 30);
    const closed = await ctx.quiz("Closed");
    await nino.mutation(api.assessments.setStatus, { assessmentId: closed, status: "published" });
    await settle(t);
    await t.run(async (db) => {
      await db.db.patch("assessments", closed, { settings: { ...(await db.db.get("assessments", closed))!.settings, closesAt: Date.now() - HOUR } });
    });
    expect(await runReminders(t)).toBe(0);
    expect((await ana.query(api.notifications.inbox, {})).items.map((item) => item.kind)).toEqual([
      "published",
      "published",
    ]);
  });
});
