/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import { renderGroupInviteEmail } from "./lib/email/templates";
import { expectAppError, person, seed } from "./test.setup";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A student outside any university: names and the honesty notice only. */
async function independentStudent(t: Awaited<ReturnType<typeof seed>>["t"], name: string) {
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

describe("groups", () => {
  test("joining by link gives every shared course, now and later; the link can be closed and replaced", async () => {
    const { t, nino, maka, courseId } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "CS-101 A" });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
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

    await nino.mutation(api.groups.setInviteLink, { groupId, enabled: false });
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    const fresh = await nino.mutation(api.groups.newInviteLink, { groupId });
    expect(fresh).not.toBe(inviteCode);
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    expect(await t.query(api.groups.preview, { code: fresh })).not.toBeNull();
  });

  test("leaving a group keeps a course the student also joined by code", async () => {
    const { nino, ana, maka, courseId } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Evening" });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode }); // ana also joined by code in seed()
    await maka.mutation(api.groups.join, { code: inviteCode });

    const detail = await nino.query(api.groups.get, { groupId });
    expect(detail.members).toBe(2);
    const makaId = detail.memberList.find((m) => m.email === "maka@example.com")!.userId;
    const anaId = detail.memberList.find((m) => m.email === "ana@example.com")!.userId;
    await nino.mutation(api.groups.removeStudent, { groupId, userId: makaId });
    await nino.mutation(api.groups.removeStudent, { groupId, userId: anaId });
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
    const { t, nino, maka, giorgi, courseId } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Saturday tutoring" });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });

    const result = await nino.mutation(api.groups.invite, {
      groupId,
      emails: ["Maka@Example.com, not-an-email\nnew.student@example.com", "maka@example.com"],
    });
    expect(result.invited).toEqual(["maka@example.com", "new.student@example.com"]);
    expect(result.invalid).toEqual(["not-an-email"]);
    expect(result.emailed).toBe(0); // no RESEND_API_KEY in tests
    expect((await nino.mutation(api.groups.invite, { groupId, emails: ["maka@example.com"] })).alreadyInvited).toEqual([
      "maka@example.com",
    ]);

    const [invite] = await maka.query(api.groups.myInvites, {});
    expect(invite).toMatchObject({ groupName: "Saturday tutoring" });
    expect(await t.query(api.groups.previewEmailInvite, { token: invite.token })).toMatchObject({
      email: "maka@example.com",
      status: "pending",
    });

    await expectAppError(giorgi.mutation(api.groups.acceptEmailInvite, { token: invite.token }), "FORBIDDEN");
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    expect(await maka.query(api.groups.myInvites, {})).toHaveLength(0);
    expect((await maka.query(api.groups.mine, {})).map((g) => g.name)).toEqual(["Saturday tutoring"]);
    // Accepting twice is fine for the same person.
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });

    const detail = await nino.query(api.groups.get, { groupId });
    expect(detail.inviteList.map((i) => i.email)).toEqual(["new.student@example.com"]);
    expect(detail.memberList[0]).toMatchObject({ email: "maka@example.com", via: "email" });
    expect((await nino.mutation(api.groups.invite, { groupId, emails: ["maka@example.com"] })).alreadyMembers).toEqual([
      "maka@example.com",
    ]);

    await nino.mutation(api.groups.withdrawInvite, { inviteId: detail.inviteList[0]._id });
    expect((await nino.query(api.groups.get, { groupId })).inviteList).toHaveLength(0);
  });

  test("other lecturers can't see or use someone else's group", async () => {
    const { t, nino, courseId, universityId } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Mine" });
    const other = t.withIdentity(person("levan"));
    const levanId = await other.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: levanId, role: "lecturer", universityId });
    });
    await expectAppError(other.query(api.groups.get, { groupId }), "NOT_FOUND");
    await expectAppError(other.mutation(api.groups.invite, { groupId, emails: ["x@example.com"] }), "NOT_FOUND");
    const own = await other.mutation(api.groups.create, { name: "Levan's" });
    // A group of one's own still can't take a course one doesn't edit.
    await expectAppError(other.mutation(api.groups.shareCourse, { groupId: own, courseId }), "NOT_FOUND");
    expect(await other.query(api.groups.listMine, {})).toHaveLength(1);
  });

  test("an archived group takes no one new but its members keep their courses", async () => {
    const { nino, maka, giorgi, courseId } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Old" });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    await nino.mutation(api.groups.update, { groupId, archived: true });
    await expectAppError(giorgi.mutation(api.groups.join, { code: inviteCode }), "NOT_FOUND");
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
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

describe("outside universities", () => {
  test("a student without a university joins by group link; a university course's code stays closed to them", async () => {
    const { t, nino, courseId, joinCode } = await seed();
    const sandro = await independentStudent(t, "sandro");
    const me = await sandro.query(api.users.me, {});
    expect(me).toMatchObject({ needsOnboarding: false });
    expect(me?.student?.universityId).toBeUndefined();

    const result = await sandro.mutation(api.learn.join, { code: joinCode });
    expect(result).toMatchObject({ ok: false });

    const groupId = await nino.mutation(api.groups.create, { name: "Private lessons" });
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
    const { nino } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Big class" });
    const rows = Array.from({ length: 80 }, (_, i) => `Student Number${i} student${i}@example.com`);
    const result = await nino.mutation(api.groups.invite, { groupId, emails: [rows.join("\n")] });
    expect(result.invited).toHaveLength(80);
    expect(result.invalid.length).toBeGreaterThan(0);
    expect((await nino.query(api.groups.get, { groupId })).pendingInvites).toBe(80);
  });

  test("the course's owner can take it back from someone else's group", async () => {
    const { nino, maka, admin, courseId } = await seed();
    // The super admin shares nino's course with a group nino doesn't run.
    const groupId = await admin.mutation(api.groups.create, { name: "Admin's group" });
    await admin.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await admin.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    await nino.mutation(api.groups.unshareCourse, { groupId, courseId });
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(0);
  });

  test("member and invite counts stay right through joins, leaves, accepts and withdrawals", async () => {
    const { nino, ana, maka, giorgi } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Counts" });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode });
    await giorgi.mutation(api.groups.join, { code: inviteCode });
    await nino.mutation(api.groups.invite, { groupId, emails: ["maka@example.com", "x@example.com"] });
    const [invite] = await maka.query(api.groups.myInvites, {});
    await maka.mutation(api.groups.acceptEmailInvite, { token: invite.token });
    await giorgi.mutation(api.groups.leave, { groupId });
    let detail = await nino.query(api.groups.get, { groupId });
    expect([detail.members, detail.memberList.length, detail.pendingInvites, detail.inviteList.length]).toEqual([2, 2, 1, 1]);
    await nino.mutation(api.groups.withdrawInvite, { inviteId: detail.inviteList[0]._id });
    detail = await nino.query(api.groups.get, { groupId });
    expect([detail.members, detail.pendingInvites]).toEqual([2, 0]);
  });

  test("a deleted teacher's group stops taking new students but keeps its members", async () => {
    const { t, nino, ana, maka } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "Orphan" });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode });
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "nino" });
    expect(await t.query(api.groups.preview, { code: inviteCode })).toBeNull();
    await expectAppError(maka.mutation(api.groups.join, { code: inviteCode }), "NOT_FOUND");
    expect((await ana.query(api.groups.mine, {})).map((g) => g.name)).toEqual(["Orphan"]);
  });

  test("students never see a lecturer's email address as their name", async () => {
    const { t, nino, maka } = await seed();
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      await ctx.db.patch("users", ninoId, { firstName: undefined, lastName: undefined });
    });
    const groupId = await nino.mutation(api.groups.create, { name: "No name" });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    expect((await maka.query(api.groups.preview, { code: inviteCode }))?.teacher).toBe("Lecturer");
  });
});
