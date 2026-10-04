/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { PURGE_BATCH } from "./model/coursePurge";
import { expectAppError, seed, settle, type TestBackend } from "./test.setup";

/** A course with a bit of everything: a week with a lesson, a quiz a student answered, a group share. */
async function busyCourse() {
  const s = await seed();
  const { nino, ana, courseId, quiz } = s;
  const weekId = await nino.mutation(api.weeks.create, { courseId, title: "Week 1" });
  await nino.mutation(api.lessons.create, { weekId, title: "Intro", blocks: [{ type: "text", md: "Hello" }] });
  const { assessmentId, questionId } = await quiz("Quiz 1");
  await ana.mutation(api.learn.startAttempt, { assessmentId });
  await ana.mutation(api.learn.saveQuizAnswer, {
    assessmentId,
    questionId,
    answer: { type: "short", text: "Cascading Style Sheets" },
  });
  await ana.mutation(api.learn.submit, { assessmentId });
  const groupId = await nino.mutation(api.groups.create, { name: "CS-101 A" });
  await nino.mutation(api.groups.shareCourse, { groupId, courseId });
  await settle(s.t);
  return { ...s, groupId, assessmentId };
}

/** Rows still pointing at the course, table by table (only tables that have any). */
async function leftovers(t: TestBackend, courseId: Id<"courses">, assessmentId: Id<"assessments">) {
  return await t.run(async (ctx) => {
    const byCourse: TableNames[] = [
      "assessments",
      "weeks",
      "lessons",
      "enrollments",
      "courseStaff",
      "courseGroups",
      "courseDrive",
      "notifications",
      "attempts",
      "questions",
    ];
    const counts: Record<string, number> = {};
    for (const table of byCourse) {
      const rows = (await ctx.db.query(table).take(10_000)) as Array<{ courseId?: unknown; assessmentId?: unknown }>;
      const n = rows.filter((row) => row.courseId === courseId || row.assessmentId === assessmentId).length;
      if (n > 0) counts[table] = n;
    }
    for (const table of ["responses", "answerKeys", "notificationRuns"] as const) {
      const n = (await ctx.db.query(table).take(10_000)).length;
      if (n > 0) counts[table] = n;
    }
    if ((await ctx.db.get("courses", courseId)) !== null) counts.courses = 1;
    return counts;
  });
}

describe("deleting a course", () => {
  test("removes it with everything inside, for staff and students alike", async () => {
    const { t, nino, ana, courseId, groupId, assessmentId } = await busyCourse();
    expect(await ana.query(api.learn.myCourses, {})).toHaveLength(1);
    expect((await ana.query(api.notifications.inbox, {})).items.length).toBeGreaterThan(0);
    expect(Object.keys(await leftovers(t, courseId, assessmentId)).length).toBeGreaterThan(5);

    await nino.mutation(api.courses.remove, { courseId });
    // Gone from every list straight away, before the clean-up runs.
    expect(await nino.query(api.courses.listMine, {})).toEqual([]);
    expect(await ana.query(api.learn.myCourses, {})).toEqual([]);
    await expectAppError(nino.query(api.courses.get, { courseId }), "NOT_FOUND");

    await settle(t);
    expect(await leftovers(t, courseId, assessmentId)).toEqual({});
    expect((await ana.query(api.notifications.inbox, {})).items).toEqual([]);
    expect((await nino.query(api.groups.get, { groupId })).courses).toEqual([]);
    const [latest] = await nino.query(api.audit.recentForMe, {});
    expect(latest).toMatchObject({ action: "course.delete", summary: 'Deleted course "Web basics"' });
  });

  test("only the owner or an admin can delete it", async () => {
    const { nino, ana, admin, courseId } = await busyCourse();
    await expectAppError(ana.mutation(api.courses.remove, { courseId }), "FORBIDDEN");
    await admin.mutation(api.courses.remove, { courseId });
    expect(await nino.query(api.courses.listMine, {})).toEqual([]);
  });

  test("a big course is cleared out over several runs", async () => {
    const { t, nino, courseId, assessmentId } = await busyCourse();
    await t.run(async (ctx) => {
      const sample = await ctx.db.query("notifications").first();
      if (sample === null) throw new Error("expected a notification");
      const row = { ...sample } as Partial<typeof sample>;
      delete row._id;
      delete row._creationTime;
      for (let i = 0; i < PURGE_BATCH * 2; i++) {
        await ctx.db.insert("notifications", row as Omit<typeof sample, "_id" | "_creationTime">);
      }
    });
    await nino.mutation(api.courses.remove, { courseId });
    await settle(t);
    expect(await leftovers(t, courseId, assessmentId)).toEqual({});
  });
});
