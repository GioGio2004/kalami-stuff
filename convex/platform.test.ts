/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { expectAppError, person, seed, settle } from "./test.setup";

type Env = Awaited<ReturnType<typeof seed>>;

const NOW = Date.now();
const PAGE = { numItems: 50, cursor: null };

/** A university admin (or lecturer) at a university, straight into memberships. */
async function staffAt(t: Env["t"], name: string, universityId: Id<"universities"> | undefined, role: "lecturer" | "uni_admin") {
  const identity = t.withIdentity(person(name));
  const userId = await identity.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId, role, universityId });
  });
  return { identity, userId };
}

/** ana takes the seeded quiz and gets it right. */
async function anaTakesAQuiz(env: Env) {
  const { assessmentId, questionId } = await env.quiz("Quiz 1");
  await env.ana.mutation(api.learn.startAttempt, { assessmentId });
  await env.ana.mutation(api.learn.saveQuizAnswer, {
    assessmentId,
    questionId,
    answer: { type: "short", text: "Cascading Style Sheets" },
  });
  await env.ana.mutation(api.learn.submit, { assessmentId });
  await settle(env.t);
  return assessmentId;
}

describe("admin panel: who gets in", () => {
  test("lecturers and students are refused everywhere; a university admin is refused the super admin's pages", async () => {
    const { t, nino, ana, universityId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    for (const caller of [nino, ana]) {
      await expectAppError(caller.query(api.platform.overview, { now: NOW }), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.students, { paginationOpts: PAGE }), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.staff, {}), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.courses, { paginationOpts: PAGE }), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.groups, {}), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.universities, { now: NOW }), "FORBIDDEN");
    }
    await expectAppError(dean.query(api.platform.activity, { paginationOpts: PAGE }), "FORBIDDEN");
    await expectAppError(dean.query(api.platform.system, { now: NOW }), "FORBIDDEN");
    await expectAppError(dean.mutation(api.platform.clearEmailSuppression, { email: "x@example.com" }), "FORBIDDEN");
    await expectAppError(
      dean.mutation(api.platform.updateUniversity, { universityId, status: "archived" }),
      "FORBIDDEN",
    );
  });

  test("a university admin sees their own university only", async () => {
    const { t, admin, universityId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    await staffAt(t, "tsu-lecturer", elsewhere, "lecturer");

    const mine = await dean.query(api.platform.overview, { now: NOW });
    expect(mine.isSuperAdmin).toBe(false);
    expect(mine.universities.map((u) => u._id)).toEqual([universityId]);
    expect(mine.people).toMatchObject({ students: 3, lecturers: 1, uniAdmins: 1 });
    expect(mine.people.superAdmins).toBeUndefined();
    expect(mine.recent).toEqual([]);
    await expectAppError(dean.query(api.platform.overview, { university: elsewhere, now: NOW }), "FORBIDDEN");
    await expectAppError(dean.query(api.platform.students, { university: "none", paginationOpts: PAGE }), "FORBIDDEN");

    const everything = await admin.query(api.platform.overview, { now: NOW });
    expect(everything.universities).toHaveLength(2);
    expect(everything.people).toMatchObject({ students: 3, lecturers: 2, uniAdmins: 1, superAdmins: 1 });
    expect((await admin.query(api.platform.overview, { university: elsewhere, now: NOW })).people.lecturers).toBe(1);
  });
});

describe("admin panel: overview and universities", () => {
  test("the overview counts people, courses, assessments, groups, invites and recent changes", async () => {
    const env = await seed();
    const { t, admin, nino, universityId, courseId } = env;
    await staffAt(t, "dean", universityId, "uni_admin");
    await env.quiz("Quiz 1");
    await nino.mutation(api.assessments.create, { courseId, kind: "midterm", title: "Midterm" });
    await admin.mutation(api.groups.create, { universityId, name: "CS-1" });
    await admin.mutation(api.invites.create, { universityId, email: "new@example.com", role: "lecturer" });

    const overview = await admin.query(api.platform.overview, { now: NOW });
    expect(overview.courses).toEqual({ draft: 0, published: 1, archived: 0, total: 1 });
    expect(overview.assessments).toMatchObject({ draft: 1, published: 1, archived: 0, byKind: { quiz: 1, midterm: 1, task: 0, final: 0 }, approximate: false });
    expect(overview.groups).toEqual({ active: 1, archived: 0 });
    expect(overview.pendingInvites).toBe(1);
    expect(overview.openTeamConversations).toBe(0);
    expect(overview.live).toEqual({ attemptsInProgress: 0, closingSoon: [] });
    expect(overview.recent.length).toBeGreaterThan(0);
    expect(overview.recent[0]).toMatchObject({ actorName: "admin", via: "web" });

    // An attempt in progress shows as live.
    const { assessmentId } = await env.quiz("Quiz 2");
    await env.ana.mutation(api.learn.startAttempt, { assessmentId });
    expect((await admin.query(api.platform.overview, { now: NOW })).live.attemptsInProgress).toBe(1);
  });

  test("universities come with their counts; the super admin renames, re-slugs, archives and restores them", async () => {
    const { t, admin, universityId } = await seed();
    await staffAt(t, "dean", universityId, "uni_admin");
    await admin.mutation(api.groups.create, { universityId, name: "CS-1" });
    const [gori] = await admin.query(api.platform.universities, { now: NOW });
    expect(gori).toMatchObject({ slug: "gori", status: "active", students: 3, lecturers: 1, admins: 1, courses: 1, publishedCourses: 1, groups: 1, pendingInvites: 0 });

    await admin.mutation(api.platform.updateUniversity, { universityId, nameEn: "Gori State University", slug: "gori-state" });
    await admin.mutation(api.platform.updateUniversity, { universityId, status: "archived" });
    const [archived] = await admin.query(api.platform.universities, { now: NOW });
    expect(archived).toMatchObject({ name: { en: "Gori State University", ka: "გორი" }, slug: "gori-state", status: "archived" });
    // An archived university takes no new students or staff.
    await expectAppError(
      admin.mutation(api.invites.create, { universityId, email: "late@example.com", role: "lecturer" }),
      "NOT_FOUND",
    );
    await admin.mutation(api.platform.updateUniversity, { universityId, status: "active" });
    expect((await admin.query(api.platform.universities, { now: NOW }))[0].status).toBe("active");

    const other = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    await expectAppError(admin.mutation(api.platform.updateUniversity, { universityId: other, slug: "gori-state" }), "CONFLICT");
    await expectAppError(admin.mutation(api.platform.updateUniversity, { universityId: other, slug: "Not a slug!" }), "INVALID_INPUT");
    const log = await admin.query(api.platform.activity, { targetTable: "universities", paginationOpts: PAGE });
    expect(log.page.map((row) => row.action)).toEqual(["university.active", "university.archived", "university.update"]);
  });
});

describe("admin panel: students", () => {
  test("students are listed newest first with their counts, found by email, and opened with their work", async () => {
    const env = await seed();
    const { t, admin, ana, universityId } = env;
    await anaTakesAQuiz(env);
    const anaId = (await ana.query(api.users.me, {}))!._id;

    const page = await admin.query(api.platform.students, { paginationOpts: PAGE });
    expect(page.isDone).toBe(true);
    expect(page.page.map((row) => row.email)).toEqual(["maka@example.com", "giorgi@example.com", "ana@example.com"]);
    const anaRow = page.page.find((row) => row.userId === anaId)!;
    expect(anaRow).toMatchObject({ name: "ana S", universityName: { en: "Gori State" }, faculty: "CS", group: "CS-1", year: 1, courses: 1, groups: 0, onboarded: true });
    expect(page.page.find((row) => row.email === "maka@example.com")!.courses).toBe(0);
    expect((await admin.query(api.platform.students, { university: "none", paginationOpts: PAGE })).page).toEqual([]);
    expect((await admin.query(api.platform.students, { university: universityId, paginationOpts: PAGE })).page).toHaveLength(3);

    expect((await admin.query(api.platform.findStudents, { query: "AN" })).map((r) => r.email)).toEqual(["ana@example.com"]);
    expect(await admin.query(api.platform.findStudents, { query: "a" })).toEqual([]);
    expect(await admin.query(api.platform.findStudents, { query: "nino" })).toEqual([]);

    const detail = await admin.query(api.platform.student, { userId: anaId });
    expect(detail.enrollments).toHaveLength(1);
    expect(detail.enrollments[0]).toMatchObject({ courseTitle: "Web basics", status: "active", viaCode: true, groupNames: [] });
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]).toMatchObject({ assessmentTitle: "Quiz 1", kind: "quiz", status: "submitted", score: 1, maxScore: 1, percent: 100, integrity: "green" });
    expect(detail.stats).toEqual({ attempts: 1, submitted: 1, inProgress: 0, needsGrading: 0, averagePercent: 100, bestPercent: 100, flagged: 0 });

    // Not a student: the staff lookup refuses.
    const ninoId = (await env.nino.query(api.users.me, {}))!._id;
    await expectAppError(admin.query(api.platform.student, { userId: ninoId }), "NOT_FOUND");
    // Deleted accounts don't show.
    await t.run(async (ctx) => {
      await ctx.db.patch("users", anaId, { deletedAt: Date.now() });
    });
    expect((await admin.query(api.platform.students, { paginationOpts: PAGE })).page.map((row) => row.email)).not.toContain("ana@example.com");
  });

  test("an admin removes a student from a course and lets them back in", async () => {
    const { admin, ana, courseId } = await seed();
    const anaId = (await ana.query(api.users.me, {}))!._id;
    const before = await admin.query(api.platform.student, { userId: anaId });
    const enrollmentId = before.enrollments[0]._id;

    await admin.mutation(api.platform.setEnrollmentStatus, { enrollmentId, status: "removed" });
    expect((await admin.query(api.platform.student, { userId: anaId })).enrollments[0].status).toBe("removed");
    expect((await ana.query(api.learn.myCourses, {})).map((c) => c._id)).not.toContain(courseId);

    await admin.mutation(api.platform.setEnrollmentStatus, { enrollmentId, status: "active" });
    expect((await admin.query(api.platform.student, { userId: anaId })).enrollments[0]).toMatchObject({ status: "active", viaCode: true });
    expect((await ana.query(api.learn.myCourses, {})).map((c) => c._id)).toContain(courseId);
    const log = await admin.query(api.platform.activity, { targetTable: "enrollments", paginationOpts: PAGE });
    expect(log.page.map((row) => row.action)).toEqual(["enrollment.active", "enrollment.removed"]);
  });

  test("an admin edits a student's profile; only the super admin moves them out of every university", async () => {
    const { t, admin, ana, universityId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const anaId = (await ana.query(api.users.me, {}))!._id;

    await dean.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId, faculty: "Informatics", group: "ICT-24-1", year: 2, studentNumber: "S-42" });
    expect((await dean.query(api.platform.student, { userId: anaId })).profile).toMatchObject({ faculty: "Informatics", group: "ICT-24-1", year: 2, studentNumber: "S-42" });
    await expectAppError(dean.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId: null }), "FORBIDDEN");
    await expectAppError(
      admin.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId, faculty: "CS", group: "CS-1", year: 9 }),
      "INVALID_INPUT",
    );
    await expectAppError(
      admin.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId, faculty: "", group: "CS-1", year: 1 }),
      "INVALID_INPUT",
    );

    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    await expectAppError(
      dean.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId: elsewhere, faculty: "CS", group: "A", year: 1 }),
      "FORBIDDEN",
    );
    await admin.mutation(api.platform.updateStudentProfile, { userId: anaId, universityId: null });
    const moved = (await admin.query(api.platform.student, { userId: anaId })).profile;
    expect([moved.universityId, moved.universityName, moved.faculty, moved.group, moved.year]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // Moved out of Gori, ana is no longer the dean's student.
    await expectAppError(dean.query(api.platform.student, { userId: anaId }), "NOT_FOUND");
    expect((await ana.query(api.users.me, {}))!.student?.universityId).toBeUndefined();
  });
});

describe("admin panel: staff", () => {
  test("staff are listed once each with roles and counts, filtered by role and university, and found by email", async () => {
    const { t, admin, nino, universityId } = await seed();
    const { identity: dean, userId: deanId } = await staffAt(t, "dean", universityId, "uni_admin");
    // dean also lectures: still one row.
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: deanId, role: "lecturer", universityId });
    });

    const all = await admin.query(api.platform.staff, {});
    expect(all.map((row) => row.email)).toEqual(["admin@example.com", "dean@example.com", "nino@example.com"]);
    const ninoRow = all.find((row) => row.email === "nino@example.com")!;
    expect(ninoRow).toMatchObject({ ownedCourses: 1, assistantCourses: 0, groups: 0 });
    expect(ninoRow.roles.map((r) => [r.role, r.universityName?.en])).toEqual([["lecturer", "Gori State"]]);
    expect(ninoRow.lastActiveAt).toBeDefined();
    expect(all.find((row) => row.email === "dean@example.com")!.roles.map((r) => r.role).sort()).toEqual(["lecturer", "uni_admin"]);

    expect((await admin.query(api.platform.staff, { role: "lecturer" })).map((r) => r.email)).toEqual(["dean@example.com", "nino@example.com"]);
    expect((await admin.query(api.platform.staff, { role: "super_admin" })).map((r) => r.email)).toEqual(["admin@example.com"]);
    // A university admin's list has no super admins.
    expect((await dean.query(api.platform.staff, {})).map((r) => r.email)).toEqual(["dean@example.com", "nino@example.com"]);
    expect((await admin.query(api.platform.findStaff, { query: "nin" })).map((r) => r.email)).toEqual(["nino@example.com"]);
    expect(await admin.query(api.platform.findStaff, { query: "ana" })).toEqual([]);

    const ninoId = (await nino.query(api.users.me, {}))!._id;
    const detail = await admin.query(api.platform.staffMember, { userId: ninoId });
    expect(detail.courses).toHaveLength(1);
    expect(detail.courses[0]).toMatchObject({ title: "Web basics", role: "owner", students: 2, assessments: { draft: 0, published: 0, archived: 0 } });
    expect(detail.activity.length).toBeGreaterThan(0);
    expect((await dean.query(api.platform.staffMember, { userId: ninoId })).activity).toEqual([]);
  });

  test("roles are added: the super admin anywhere, a university admin only lecturers at home; students stay students", async () => {
    const { t, admin, nino, ana, universityId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    const anaId = (await ana.query(api.users.me, {}))!._id;
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const levan = t.withIdentity(person("levan"));
    const levanId = await levan.mutation(api.users.store, {});

    await admin.mutation(api.platform.addStaffRole, { userId: ninoId, role: "lecturer", universityId: elsewhere });
    expect((await admin.query(api.platform.staffMember, { userId: ninoId })).profile.roles).toHaveLength(2);
    // Adding the same role again changes nothing.
    await admin.mutation(api.platform.addStaffRole, { userId: ninoId, role: "lecturer", universityId: elsewhere });
    expect((await admin.query(api.platform.staffMember, { userId: ninoId })).profile.roles).toHaveLength(2);

    await dean.mutation(api.platform.addStaffRole, { userId: levanId, role: "lecturer", universityId });
    expect((await levan.query(api.users.me, {}))!.isStaff).toBe(true);
    await expectAppError(dean.mutation(api.platform.addStaffRole, { userId: levanId, role: "uni_admin", universityId }), "FORBIDDEN");
    await expectAppError(dean.mutation(api.platform.addStaffRole, { userId: levanId, role: "lecturer", universityId: elsewhere }), "FORBIDDEN");
    await expectAppError(dean.mutation(api.platform.addStaffRole, { userId: levanId, role: "lecturer" }), "FORBIDDEN");
    await expectAppError(admin.mutation(api.platform.addStaffRole, { userId: anaId, role: "lecturer", universityId }), "CONFLICT");
    await expectAppError(admin.mutation(api.platform.addStaffRole, { userId: levanId, role: "uni_admin" }), "INVALID_INPUT");
    // An independent lecturer, by the super admin.
    await admin.mutation(api.platform.addStaffRole, { userId: levanId, role: "lecturer" });
    expect((await admin.query(api.platform.staffMember, { userId: levanId })).profile.roles.map((r) => r.universityId)).toEqual([universityId, undefined]);
  });
});

describe("admin panel: courses and groups", () => {
  test("courses are listed with owner and counts, filtered by status, found by title or code, and opened", async () => {
    const env = await seed();
    const { admin, nino, universityId, courseId } = env;
    await anaTakesAQuiz(env);
    await nino.mutation(api.assessments.create, { courseId, kind: "final", title: "Final" });
    const second = await nino.mutation(api.courses.create, { title: "Databases" });

    const all = await admin.query(api.platform.courses, { paginationOpts: PAGE });
    expect(all.page.map((row) => row.title)).toEqual(["Databases", "Web basics"]);
    const web = all.page[1];
    expect(web).toMatchObject({ status: "published", ownerName: "nino", ownerEmail: "nino@example.com", students: 2, universityName: { en: "Gori State" }, assessments: { draft: 1, published: 1, archived: 0 } });
    expect((await admin.query(api.platform.courses, { status: "draft", paginationOpts: PAGE })).page.map((r) => r._id)).toEqual([second]);
    expect((await admin.query(api.platform.courses, { university: universityId, status: "published", paginationOpts: PAGE })).page.map((r) => r._id)).toEqual([courseId]);
    expect((await admin.query(api.platform.courses, { university: "none", paginationOpts: PAGE })).page).toEqual([]);
    expect((await admin.query(api.platform.findCourses, { query: "web" })).map((r) => r._id)).toEqual([courseId]);
    expect((await admin.query(api.platform.findCourses, { query: web.joinCode.toLowerCase() })).map((r) => r._id)).toEqual([courseId]);

    const detail = await admin.query(api.platform.course, { courseId });
    expect(detail.staff).toEqual([{ userId: expect.any(String), name: "nino", email: "nino@example.com", role: "owner" }]);
    expect(detail.assessments.map((a) => [a.title, a.status, a.submitted])).toEqual([["Final", "draft", 0], ["Quiz 1", "published", 1]]);
    expect(detail.enrollments).toEqual({ active: 2, removed: 0 });
  });

  test("a course is handed to another lecturer; the old owner stays as an assistant", async () => {
    const { t, admin, nino, ana, universityId, courseId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    await expectAppError(admin.mutation(api.platform.transferCourse, { courseId, newOwnerEmail: "ana@example.com" }), "CONFLICT");
    await expectAppError(admin.mutation(api.platform.transferCourse, { courseId, newOwnerEmail: "nobody@example.com" }), "NOT_FOUND");

    await dean.mutation(api.platform.transferCourse, { courseId, newOwnerEmail: " Dean@Example.com " });
    const detail = await admin.query(api.platform.course, { courseId });
    expect(detail.course).toMatchObject({ ownerName: "dean", ownerEmail: "dean@example.com" });
    expect(detail.staff.map((s) => [s.email, s.role]).sort()).toEqual([["dean@example.com", "owner"], ["nino@example.com", "assistant"]]);
    // nino still sees the course, but can't edit it any more.
    expect((await nino.query(api.courses.get, { courseId })).canEdit).toBe(false);
    await expectAppError(nino.mutation(api.courses.update, { courseId, title: "Mine again" }), "FORBIDDEN");
    expect((await ana.query(api.learn.myCourses, {})).map((c) => c._id)).toContain(courseId);

    // A university admin elsewhere can't even see it.
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const { identity: otherDean } = await staffAt(t, "other", elsewhere, "uni_admin");
    await expectAppError(otherDean.query(api.platform.course, { courseId }), "NOT_FOUND");
    await expectAppError(otherDean.mutation(api.platform.transferCourse, { courseId, newOwnerEmail: "other@example.com" }), "NOT_FOUND");
  });

  test("groups are listed across universities with their counts", async () => {
    const { t, admin, nino, universityId, courseId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const groupId = await admin.mutation(api.groups.create, { universityId, name: "ICT-24-1", description: "Evening" });
    await nino.mutation(api.groups.joinAsLecturer, { groupId });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    await admin.mutation(api.groups.update, { groupId, archived: true });

    const rows = await admin.query(api.platform.groups, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "ICT-24-1", description: "Evening", universityName: { en: "Gori State" }, ownerName: "admin", archived: true, inviteEnabled: true, members: 0, lecturers: 1, courses: 1 });
    expect(await dean.query(api.platform.groups, {})).toHaveLength(1);
    expect(await admin.query(api.platform.groups, { university: "none" })).toEqual([]);
  });
});

describe("admin panel: activity and system", () => {
  test("the activity log pages through every change, newest first, and filters by what changed", async () => {
    const { admin, nino, courseId } = await seed();
    await nino.mutation(api.courses.update, { courseId, title: "Web basics II" });
    const page = await admin.query(api.platform.activity, { paginationOpts: { numItems: 2, cursor: null } });
    expect(page.page).toHaveLength(2);
    expect(page.isDone).toBe(false);
    expect(page.page[0]).toMatchObject({ action: "course.update", actorName: "nino", actorEmail: "nino@example.com", courseTitle: "Web basics II", via: "web" });
    const courses = await admin.query(api.platform.activity, { targetTable: "courses", paginationOpts: PAGE });
    expect(courses.page.every((row) => row.targetTable === "courses")).toBe(true);
    expect(courses.page.map((row) => row.action)).toEqual(["course.update", "course.update", "course.create"]);
  });

  test("the system page reports the deploy guard, email suppressions and jobs; a suppression can be lifted", async () => {
    const { t, admin, ana } = await seed();
    const anaId = (await ana.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      await ctx.db.insert("emailSuppressions", { email: "ana@example.com", status: "bounced", at: NOW });
      await ctx.db.patch("users", anaId, { emailStatus: "bounced" });
    });
    const system = await admin.query(api.platform.system, { now: NOW });
    expect(system.deploy.busy).toBe(false);
    expect(system.email.suppressions).toEqual([
      { _id: expect.any(String), email: "ana@example.com", status: "bounced", at: NOW, userId: anaId, name: "ana S" },
    ]);
    expect(system.migration.materialsLeft).toBe(0);
    expect(system.scheduledJobs.length).toBe(5);
    expect((await admin.query(api.platform.students, { paginationOpts: PAGE })).page.find((r) => r.userId === anaId)!.emailOff).toBe("bounced");

    await admin.mutation(api.platform.clearEmailSuppression, { email: "ANA@example.com" });
    expect((await admin.query(api.platform.system, { now: NOW })).email.suppressions).toEqual([]);
    expect((await admin.query(api.platform.students, { paginationOpts: PAGE })).page.find((r) => r.userId === anaId)!.emailOff).toBeUndefined();
  });
});
