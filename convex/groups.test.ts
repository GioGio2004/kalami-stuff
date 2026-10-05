/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import { renderGroupInviteEmail } from "./lib/email/templates";
import { expectAppError, person, seed } from "./test.setup";

afterEach(() => {
  vi.unstubAllEnvs();
});

type Env = Awaited<ReturnType<typeof seed>>;

/** A student outside any university: names and the honesty notice only. */
async function independentStudent(t: Env["t"], name: string) {
  const identity = t.withIdentity(person(name));
  await identity.mutation(api.users.store, {});
  await identity.mutation(api.users.completeStudentOnboarding, {
    firstName: name,
    lastName: "T",
    locale: "en",
    honestyVersion: HONESTY_NOTICE.version,
  });
  return identity;
}

/** Another staff member at a university, with the given role. */
async function staffAt(t: Env["t"], name: string, universityId: Id<"universities">, role: "lecturer" | "uni_admin" = "lecturer") {
  const identity = t.withIdentity(person(name));
  const userId = await identity.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId, role, universityId });
  });
  return { identity, userId };
}

/** A teacher outside any university, invited by the super admin. */
async function independentTeacher(env: Env, name: string) {
  const { token } = await env.admin.mutation(api.invites.create, { email: `${name}@example.com`, role: "lecturer" });
  const identity = env.t.withIdentity(person(name));
  await identity.mutation(api.users.store, {});
  await identity.mutation(api.invites.accept, { token });
  return identity;
}

/** A group of the seeded university, made by the admin, that nino teaches. */
async function ninosGroup(env: Env, name: string) {
  const groupId = await env.admin.mutation(api.groups.create, { name, universityId: env.universityId });
  await env.nino.mutation(api.groups.joinAsLecturer, { groupId });
  return groupId;
}

describe("groups", () => {
  test("joining by link gives every shared course, now and later; the admin can close and replace the link", async () => {
    const env = await seed();
    const { t, admin, nino, maka, courseId } = env;
    const groupId = await ninosGroup(env, "CS-101 A");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    // The lecturer who teaches the group can see (and share) its link.
    const { inviteCode } = await nino.query(api.groups.get, { groupId });

    expect(await t.query(api.groups.preview, { code: inviteCode })).toMatchObject({
      groupName: "CS-101 A",
      courseCount: 1,
      alreadyMember: false,
    });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect((await maka.query(api.learn.myCourses, {})).map((c) => c._id)).toEqual([courseId]);
    expect(await maka.query(api.groups.preview, { code: inviteCode })).toMatchObject({ alreadyMember: true });

    // A course shared afterwards reaches the existing member.
    const second = await nino.mutation(api.courses.create, { title: "Second" });
    await nino.mutation(api.courses.update, { courseId: second, status: "published" });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId: second });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(2);

    await admin.mutation(api.groups.setInviteLink, { groupId, enabled: false });
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    const fresh = await admin.mutation(api.groups.newInviteLink, { groupId });
    expect(fresh).not.toBe(inviteCode);
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    expect(await t.query(api.groups.preview, { code: fresh })).not.toBeNull();
  });

  test("removing a student keeps a course they also joined by code", async () => {
    const env = await seed();
    const { admin, nino, ana, maka, courseId } = env;
    const groupId = await ninosGroup(env, "Evening");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode }); // ana also joined by code in seed()
    await maka.mutation(api.groups.join, { code: inviteCode });

    const detail = await admin.query(api.groups.get, { groupId });
    expect(detail.members).toBe(2);
    const makaId = detail.memberList.find((m) => m.email === "maka@example.com")!.userId;
    const anaId = detail.memberList.find((m) => m.email === "ana@example.com")!.userId;
    await admin.mutation(api.groups.removeStudent, { groupId, userId: makaId });
    await admin.mutation(api.groups.removeStudent, { groupId, userId: anaId });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
    expect(await ana.query(api.learn.myCourses, {})).toHaveLength(1);

    // Unsharing works the same way.
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    await nino.mutation(api.groups.unshareCourse, { groupId, courseId });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
    expect(await nino.query(api.courses.get, { courseId })).toMatchObject({ students: 2 });
  });

  test("email invites: only the invited address can accept, duplicates are reported, the dashboard lists them", async () => {
    const env = await seed();
    const { t, admin, nino, maka, giorgi, courseId } = env;
    const groupId = await ninosGroup(env, "Saturday tutoring");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });

    const result = await admin.mutation(api.groups.invite, {
      groupId,
      emails: ["Maka@Example.com, not-an-email\nnew.student@example.com", "maka@example.com"],
    });
    expect(result.invited).toEqual(["maka@example.com", "new.student@example.com"]);
    expect(result.invalid).toEqual(["not-an-email"]);
    expect(result.emailed).toBe(0); // no RESEND_API_KEY in tests
    expect((await admin.mutation(api.groups.invite, { groupId, emails: ["maka@example.com"] })).alreadyInvited).toEqual([
      "maka@example.com",
    ]);

    const [invite] = await maka.query(api.groups.myInvites, {});
    // A personal invite comes from whoever sent it.
    expect(invite).toMatchObject({ groupName: "Saturday tutoring", teacher: "admin" });
    expect(await t.query(api.groups.previewEmailInvite, { token: invite.token })).toMatchObject({
      email: "maka@example.com",
      status: "pending",
      teacher: "admin",
    });

    await expectAppError(giorgi.mutation(api.groups.acceptEmailInvite, { token: invite.token }), "FORBIDDEN");
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    expect(await maka.query(api.groups.myInvites, {})).toHaveLength(0);
    expect((await maka.query(api.groups.mine, {})).map((g) => g.name)).toEqual(["Saturday tutoring"]);
    // Accepting twice is fine for the same person.
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });

    const detail = await admin.query(api.groups.get, { groupId });
    expect(detail.inviteList.map((i) => i.email)).toEqual(["new.student@example.com"]);
    expect(detail.memberList[0]).toMatchObject({ email: "maka@example.com", via: "email" });
    expect((await admin.mutation(api.groups.invite, { groupId, emails: ["maka@example.com"] })).alreadyMembers).toEqual([
      "maka@example.com",
    ]);

    await admin.mutation(api.groups.withdrawInvite, { inviteId: detail.inviteList[0]._id });
    expect((await admin.query(api.groups.get, { groupId })).inviteList).toHaveLength(0);
  });

  test("an archived group takes no one new but its members keep their courses", async () => {
    const env = await seed();
    const { admin, nino, maka, giorgi, courseId } = env;
    const groupId = await ninosGroup(env, "Old");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    await admin.mutation(api.groups.update, { groupId, archived: true });
    await expectAppError(giorgi.mutation(api.groups.join, { code: inviteCode }), "NOT_FOUND");
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    // Nobody new starts teaching it either.
    const { identity: levan } = await staffAt(env.t, "levan", env.universityId);
    await expectAppError(levan.mutation(api.groups.joinAsLecturer, { groupId }), "CONFLICT");
  });

  test("the invite email names the teacher and group in both languages, escaped", () => {
    const email = renderGroupInviteEmail({
      inviterName: "ნინო",
      groupName: "A <b>",
      url: "https://app.kalami.space/join/invite/abc",
    });
    expect(email.subject).toContain("ნინო");
    expect(email.html).toContain("A &lt;b&gt;");
    expect(email.html).not.toContain("<b>");
    expect(email.text).toContain("https://app.kalami.space/join/invite/abc");
    expect(email.text).toContain("Sign in with this email address to accept.");
  });
});

describe("groups: admins make them, lecturers join them", () => {
  test("a university's lecturers can't make groups; its admins can, and names are unique there", async () => {
    const env = await seed();
    const { t, admin, nino, universityId } = env;
    await expectAppError(nino.mutation(api.groups.create, { name: "Mine" }), "FORBIDDEN");
    await expectAppError(nino.mutation(api.groups.create, { name: "Mine", universityId }), "FORBIDDEN");

    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const groupId = await dean.mutation(api.groups.create, { name: "ICT-24-1", universityId });
    // Case and spacing don't make a different group, for anyone.
    await expectAppError(admin.mutation(api.groups.create, { name: "  ict-24-1 ", universityId }), "CONFLICT");
    const other = await dean.mutation(api.groups.create, { name: "ICT-24-2", universityId });
    await expectAppError(dean.mutation(api.groups.update, { groupId: other, name: "Ict-24-1" }), "CONFLICT");
    await dean.mutation(api.groups.update, { groupId, name: "ICT-24-1 (evening)" });

    // Another university's admin can't make groups here or run this one.
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const { identity: otherDean } = await staffAt(t, "otherdean", elsewhere, "uni_admin");
    await expectAppError(otherDean.mutation(api.groups.create, { name: "X", universityId }), "FORBIDDEN");
    await expectAppError(otherDean.query(api.groups.get, { groupId }), "NOT_FOUND");
    await expectAppError(otherDean.mutation(api.groups.update, { groupId, archived: true }), "NOT_FOUND");
    await expectAppError(otherDean.query(api.groups.forUniversity, { universityId }), "FORBIDDEN");
    // The same name is fine at another university.
    await otherDean.mutation(api.groups.create, { name: "ICT-24-1", universityId: elsewhere });

    expect((await dean.query(api.groups.forUniversity, { universityId })).map((g) => g.name)).toEqual([
      "ICT-24-1 (evening)",
      "ICT-24-2",
    ]);
    await expectAppError(nino.query(api.groups.forUniversity, { universityId }), "FORBIDDEN");
  });

  test("a lecturer finds only their own university's active groups, joins and leaves", async () => {
    const env = await seed();
    const { t, admin, nino, universityId } = env;
    const a = await admin.mutation(api.groups.create, { name: "ICT-24-1", universityId, description: "Informatics, year 1" });
    await admin.mutation(api.groups.create, { name: "ICT-24-2", universityId });
    await admin.mutation(api.groups.create, { name: "BIO-23", universityId });
    const archived = await admin.mutation(api.groups.create, { name: "ICT-20-1", universityId });
    await admin.mutation(api.groups.update, { groupId: archived, archived: true });
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const foreign = await admin.mutation(api.groups.create, { name: "ICT-24-9", universityId: elsewhere });
    // A tutor's private group is nobody else's to find.
    const tutor = await independentTeacher(env, "tutor");
    await tutor.mutation(api.groups.create, { name: "ICT private" });

    expect((await nino.query(api.groups.search, { query: "" })).map((g) => g.name)).toEqual(["BIO-23", "ICT-24-1", "ICT-24-2"]);
    const found = await nino.query(api.groups.search, { query: " ict-24 " });
    expect(found.map((g) => g.name)).toEqual(["ICT-24-1", "ICT-24-2"]);
    expect(found[0]).toMatchObject({
      description: "Informatics, year 1",
      joined: false,
      lecturers: 0,
      universityName: { en: "Gori State" },
    });
    expect(await nino.query(api.groups.search, { query: "nothing like it" })).toEqual([]);

    await expectAppError(nino.mutation(api.groups.joinAsLecturer, { groupId: foreign }), "NOT_FOUND");
    await nino.mutation(api.groups.joinAsLecturer, { groupId: a });
    await nino.mutation(api.groups.joinAsLecturer, { groupId: a }); // twice is fine
    expect((await nino.query(api.groups.search, { query: "ICT-24-1" }))[0]).toMatchObject({ joined: true, lecturers: 1 });
    expect((await nino.query(api.groups.listMine, {})).map((g) => [g.name, g.teaches, g.manages])).toEqual([
      ["ICT-24-1", true, false],
    ]);

    // Two lecturers share one group: no duplicate.
    const { identity: levan } = await staffAt(t, "levan", universityId);
    await levan.mutation(api.groups.joinAsLecturer, { groupId: a });
    expect((await admin.query(api.groups.get, { groupId: a })).lecturerList.map((l) => l.name)).toEqual(["levan", "nino"]);

    expect(await nino.mutation(api.groups.leaveAsLecturer, { groupId: a })).toBe(0);
    expect(await nino.query(api.groups.listMine, {})).toEqual([]);
    await expectAppError(nino.query(api.groups.get, { groupId: a }), "NOT_FOUND");
    // The super admin runs every group but teaches none, so there's nothing to search.
    expect(await admin.query(api.groups.search, { query: "" })).toEqual([]);
  });

  test("a lecturer who teaches a group shares their own courses, sees only those, and can't run the group", async () => {
    const env = await seed();
    const { t, admin, nino, universityId, courseId } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { identity: levan } = await staffAt(t, "levan", universityId);
    await levan.mutation(api.groups.joinAsLecturer, { groupId });
    const levansCourse = await levan.mutation(api.courses.create, { title: "Databases" });
    await levan.mutation(api.groups.shareCourse, { groupId, courseId: levansCourse });
    // A course levan doesn't edit can't be taken out by him.
    await expectAppError(levan.mutation(api.groups.unshareCourse, { groupId, courseId }), "NOT_FOUND");

    const asLevan = await levan.query(api.groups.get, { groupId });
    expect(asLevan).toMatchObject({
      manages: false,
      teaches: true,
      otherCourses: 1,
      memberList: [],
      inviteList: [],
      lecturerList: [],
    });
    expect(asLevan.courses.map((c) => c.title)).toEqual(["Databases"]);
    expect(asLevan.inviteCode).not.toBe("");
    const asAdmin = await admin.query(api.groups.get, { groupId });
    expect(asAdmin).toMatchObject({ manages: true, teaches: false, otherCourses: 0 });
    expect(asAdmin.courses).toHaveLength(2);

    // Running the group is the admin's.
    await expectAppError(levan.mutation(api.groups.update, { groupId, name: "Renamed" }), "NOT_FOUND");
    await expectAppError(levan.mutation(api.groups.newInviteLink, { groupId }), "NOT_FOUND");
    await expectAppError(levan.mutation(api.groups.setInviteLink, { groupId, enabled: false }), "NOT_FOUND");
    await expectAppError(levan.mutation(api.groups.invite, { groupId, emails: ["x@example.com"] }), "NOT_FOUND");
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await expectAppError(levan.mutation(api.groups.removeLecturer, { groupId, userId: ninoId }), "NOT_FOUND");

    // The course page offers the groups the lecturer teaches.
    const own = await levan.mutation(api.courses.create, { title: "Networks" });
    expect((await levan.query(api.groups.forCourse, { courseId: own })).available.map((g) => g.name)).toEqual(["ICT-24-1"]);
  });

  test("leaving takes the lecturer's courses out of the group; students keep a course they joined another way", async () => {
    const env = await seed();
    const { t, nino, ana, maka, universityId, courseId } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { identity: levan } = await staffAt(t, "levan", universityId);
    await levan.mutation(api.groups.joinAsLecturer, { groupId });
    const levansCourse = await levan.mutation(api.courses.create, { title: "Databases" });
    await levan.mutation(api.courses.update, { courseId: levansCourse, status: "published" });
    await levan.mutation(api.groups.shareCourse, { groupId, courseId: levansCourse });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode }); // ana also joined nino's course by code
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(2);

    expect(await nino.mutation(api.groups.leaveAsLecturer, { groupId })).toBe(1);
    expect((await maka.query(api.learn.myCourses, {})).map((c) => c.title)).toEqual(["Databases"]);
    expect((await ana.query(api.learn.myCourses, {})).map((c) => c.title).sort()).toEqual(["Databases", "Web basics"]);
    // Levan's course stays shared.
    expect((await levan.query(api.groups.get, { groupId })).courses.map((c) => c.title)).toEqual(["Databases"]);
  });

  test("an admin can take a lecturer off a group, with their courses", async () => {
    const env = await seed();
    const { admin, nino, maka, courseId } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await admin.mutation(api.groups.removeLecturer, { groupId, userId: ninoId });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
    expect((await admin.query(api.groups.get, { groupId })).lecturerList).toEqual([]);
    await expectAppError(nino.query(api.groups.get, { groupId }), "NOT_FOUND");
  });

  test("an independent teacher makes and runs private groups that nobody else can find", async () => {
    const env = await seed();
    const { t, nino, ana } = env;
    const tutor = await independentTeacher(env, "tutor");
    const groupId = await tutor.mutation(api.groups.create, { name: "Guitar, Saturdays" });
    expect((await tutor.query(api.groups.listMine, {}))[0]).toMatchObject({ isPrivate: true, manages: true, teaches: true });
    const courseId = await tutor.mutation(api.courses.create, { title: "Guitar theory" });
    await tutor.mutation(api.courses.update, { courseId, status: "published" });
    await tutor.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await tutor.query(api.groups.get, { groupId });
    await tutor.mutation(api.groups.invite, { groupId, emails: ["ana@example.com"] });
    const sandro = await independentStudent(t, "sandro");
    await sandro.mutation(api.groups.join, { code: inviteCode });
    expect(await sandro.query(api.learn.myCourses, {})).toHaveLength(1);
    // The owner can't leave their own group; others can't see or join it.
    await expectAppError(tutor.mutation(api.groups.leaveAsLecturer, { groupId }), "CONFLICT");
    await expectAppError(nino.query(api.groups.get, { groupId }), "NOT_FOUND");
    await expectAppError(nino.mutation(api.groups.joinAsLecturer, { groupId }), "NOT_FOUND");
    // Students see the teacher as its host.
    expect((await t.query(api.groups.preview, { code: inviteCode }))?.teacher).toBe("tutor");
    expect((await ana.query(api.groups.myInvites, {}))[0]).toMatchObject({ teacher: "tutor" });
  });

  test("students see a university group as coming from the university, in their language", async () => {
    const env = await seed();
    const { t, maka } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    const { inviteCode } = await env.nino.query(api.groups.get, { groupId });
    expect((await t.query(api.groups.preview, { code: inviteCode }))?.teacher).toBe("Gori State");
    await maka.mutation(api.groups.join, { code: inviteCode });
    // maka's account is in Georgian.
    expect((await maka.query(api.groups.mine, {}))[0]).toMatchObject({ name: "ICT-24-1", teacher: "გორი" });
  });

  test("students can write to the lecturers who teach their group, not to the admin who made it", async () => {
    const env = await seed();
    const { maka } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    const { inviteCode } = await env.nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    const options = await maka.query(api.messages.contactOptionsFor, {});
    expect(options.lecturers.map((l) => l.name)).toEqual(["nino"]);
  });
});

describe("outside universities", () => {
  test("a student without a university joins by group link; a university course's code stays closed to them", async () => {
    const env = await seed();
    const { t, nino, courseId, joinCode } = env;
    const sandro = await independentStudent(t, "sandro");
    const me = await sandro.query(api.users.me, {});
    expect(me).toMatchObject({ needsOnboarding: false });
    expect(me?.student?.universityId).toBeUndefined();

    const result = await sandro.mutation(api.learn.join, { code: joinCode });
    expect(result).toMatchObject({ ok: false });

    const groupId = await ninosGroup(env, "Private lessons");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await sandro.mutation(api.groups.join, { code: inviteCode });
    expect(await sandro.query(api.learn.myCourses, {})).toHaveLength(1);
  });

  test("a university profile still needs faculty, group and year, and can't be dropped once set", async () => {
    const { ana, universityId } = await seed();
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, {
        firstName: "ana",
        lastName: "S",
        universityId,
        locale: "ka",
        honestyVersion: HONESTY_NOTICE.version,
      }),
      "INVALID_INPUT",
    );
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, {
        firstName: "ana",
        lastName: "S",
        locale: "ka",
        honestyVersion: HONESTY_NOTICE.version,
      }),
      "FORBIDDEN",
    );
  });

  test("an independent teacher creates courses with no university, and anyone can join them by code", async () => {
    const { t, admin, ana } = await seed();
    const { token } = await admin.mutation(api.invites.create, { email: "tutor@example.com", role: "lecturer" });
    expect((await admin.query(api.invites.listForUniversity, {})).map((i) => i.email)).toEqual(["tutor@example.com"]);
    const tutor = t.withIdentity(person("tutor"));
    await tutor.mutation(api.users.store, {});
    await tutor.mutation(api.invites.accept, { token });
    expect(await t.query(api.invites.getByToken, { token })).toMatchObject({ status: "accepted" });

    const courseId = await tutor.mutation(api.courses.create, { title: "Guitar theory" });
    await tutor.mutation(api.courses.update, { courseId, status: "published" });
    const course = await tutor.query(api.courses.get, { courseId });
    expect(course.universityId).toBeUndefined();

    expect(await ana.mutation(api.learn.join, { code: course.joinCode })).toMatchObject({ ok: true });
    const nika = await independentStudent(t, "nika");
    expect(await nika.mutation(api.learn.join, { code: course.joinCode })).toMatchObject({ ok: true });

    // Only the super admin sends independent invites.
    await expectAppError(tutor.mutation(api.invites.create, { email: "x@example.com", role: "lecturer" }), "FORBIDDEN");
  });
});

describe("groups: hardening", () => {
  test("a pasted spreadsheet only costs the valid new addresses, and names don't break it", async () => {
    const env = await seed();
    const { admin } = env;
    const groupId = await ninosGroup(env, "Big class");
    const rows = Array.from({ length: 80 }, (_, i) => `Student Number${i} student${i}@example.com`);
    const result = await admin.mutation(api.groups.invite, { groupId, emails: [rows.join("\n")] });
    expect(result.invited).toHaveLength(80);
    expect(result.invalid.length).toBeGreaterThan(0);
    expect((await admin.query(api.groups.get, { groupId })).pendingInvites).toBe(80);
  });

  test("the course's owner can take it back from a group they don't teach", async () => {
    const { nino, maka, admin, courseId, universityId } = await seed();
    // The super admin shares nino's course with a group nino doesn't teach.
    const groupId = await admin.mutation(api.groups.create, { name: "Admin's group", universityId });
    await admin.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await admin.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    await nino.mutation(api.groups.unshareCourse, { groupId, courseId });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
  });

  test("member and invite counts stay right through joins, leaves, accepts and withdrawals", async () => {
    const env = await seed();
    const { admin, nino, ana, maka, giorgi } = env;
    const groupId = await ninosGroup(env, "Counts");
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode });
    await giorgi.mutation(api.groups.join, { code: inviteCode });
    await admin.mutation(api.groups.invite, { groupId, emails: ["maka@example.com", "x@example.com"] });
    const [invite] = await maka.query(api.groups.myInvites, {});
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });
    await giorgi.mutation(api.groups.leave, { groupId });
    let detail = await admin.query(api.groups.get, { groupId });
    expect([detail.members, detail.memberList.length, detail.pendingInvites, detail.inviteList.length]).toEqual([2, 2, 1, 1]);
    await admin.mutation(api.groups.withdrawInvite, { inviteId: detail.inviteList[0]._id });
    detail = await admin.query(api.groups.get, { groupId });
    expect([detail.members, detail.pendingInvites]).toEqual([2, 0]);
  });

  test("a deleted teacher's private group stops taking new students but keeps its members", async () => {
    const env = await seed();
    const { t, ana, maka } = env;
    const tutor = await independentTeacher(env, "tutor");
    const groupId = await tutor.mutation(api.groups.create, { name: "Orphan" });
    const { inviteCode } = await tutor.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode });
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "tutor" });
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    await expectAppError(maka.mutation(api.groups.join, { code: inviteCode }), "NOT_FOUND");
    expect((await ana.query(api.groups.mine, {})).map((g) => g.name)).toEqual(["Orphan"]);
  });

  test("a university's group carries on when a lecturer who teaches it is deleted", async () => {
    const env = await seed();
    const { t, admin, nino, maka, courseId } = env;
    const groupId = await ninosGroup(env, "ICT-24-1");
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "nino" });
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    expect((await admin.query(api.groups.get, { groupId })).lecturerList).toEqual([]);
  });

  test("students never see a teacher's email address as their name", async () => {
    const env = await seed();
    const { t, maka } = env;
    const tutor = await independentTeacher(env, "tutor");
    const tutorId = (await tutor.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      await ctx.db.patch("users", tutorId, { firstName: undefined, lastName: undefined });
    });
    const groupId = await tutor.mutation(api.groups.create, { name: "No name" });
    const { inviteCode } = await tutor.query(api.groups.get, { groupId });
    expect((await maka.query(api.groups.preview, { code: inviteCode }))?.teacher).toBe("Lecturer");
  });
});

describe("groups: moving old groups to universities", () => {
  test("a lecturer's old group moves to their university and they keep teaching it; a tutor's becomes private", async () => {
    const env = await seed();
    const { t, admin, nino, maka, courseId, universityId } = env;
    const tutor = await independentTeacher(env, "tutor");
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    const tutorId = (await tutor.query(api.users.me, {}))!._id;
    // Groups as lecturers made them before admins did: no university, no name key, no lecturer rows.
    const [old, oldTwin, tutors] = await t.run(async (ctx) => {
      const base = { inviteEnabled: true, memberCount: 0, pendingInvites: 0, createdVia: "web" as const, updatedAt: 1 };
      return [
        await ctx.db.insert("groups", { ...base, ownerId: ninoId, name: "CS-101", inviteCode: "oldcode-0001" }),
        await ctx.db.insert("groups", { ...base, ownerId: ninoId, name: "cs-101", inviteCode: "oldcode-0002" }),
        await ctx.db.insert("groups", { ...base, ownerId: tutorId, name: "Guitar", inviteCode: "oldcode-0003" }),
      ];
    });
    // Before the move, the owner still runs and lists it.
    await nino.mutation(api.groups.shareCourse, { groupId: old, courseId });
    await maka.mutation(api.groups.join, { code: "oldcode-0001" });
    expect((await nino.query(api.groups.listMine, {})).map((g) => g.name).sort()).toEqual(["CS-101", "cs-101"]);

    const result = await t.mutation(internal.groups.migrateToUniversityGroups, { cursor: null });
    expect(result).toMatchObject({ moved: 2, madePrivate: 1, nameClashes: 1, isDone: true });
    // Running it again changes nothing.
    expect(await t.mutation(internal.groups.migrateToUniversityGroups, { cursor: null })).toMatchObject({
      moved: 0,
      madePrivate: 0,
    });

    expect(await nino.query(api.groups.get, { groupId: old })).toMatchObject({
      manages: false,
      teaches: true,
      isPrivate: false,
      members: 1,
    });
    expect((await admin.query(api.groups.forUniversity, { universityId })).map((g) => g.name)).toEqual(["CS-101", "cs-101"]);
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    expect((await tutor.query(api.groups.get, { groupId: tutors })).isPrivate).toBe(true);
    // The admin renames one of the twins.
    await admin.mutation(api.groups.update, { groupId: oldTwin, name: "CS-101 B" });
  });
});
