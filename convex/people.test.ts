/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { expectAppError, person, seed } from "./test.setup";

type Env = Awaited<ReturnType<typeof seed>>;

async function staffAt(t: Env["t"], name: string, universityId: Id<"universities"> | undefined, role: "lecturer" | "uni_admin") {
  const identity = t.withIdentity(person(name));
  const userId = await identity.mutation(api.users.store, {});
  const membershipId = await t.run(async (ctx) => ctx.db.insert("memberships", { userId, role, universityId }));
  return { identity, userId, membershipId };
}

async function membershipsOf(t: Env["t"], userId: Id<"users">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("memberships").withIndex("by_userId", (q) => q.eq("userId", userId)).take(10)).map((m) => ({
      role: m.role,
      universityId: m.universityId,
    })),
  );
}

describe("people (super admin)", () => {
  test("only the super admin searches people and changes roles", async () => {
    const { t, nino, ana, universityId } = await seed();
    const { identity: dean } = await staffAt(t, "dean", universityId, "uni_admin");
    const [ninoRow] = (await t.withIdentity(person("admin")).query(api.people.search, { query: "nino" }))[0].memberships;
    for (const caller of [dean, nino, ana]) {
      await expectAppError(caller.query(api.people.search, { query: "nino" }), "FORBIDDEN");
      await expectAppError(caller.mutation(api.people.changeStaffRole, { membershipId: ninoRow._id, role: "uni_admin", universityId }), "FORBIDDEN");
      await expectAppError(caller.mutation(api.people.removeStaffRole, { membershipId: ninoRow._id }), "FORBIDDEN");
    }
  });

  test("search finds people by the start of their email, with their roles and universities", async () => {
    const { t, admin } = await seed();
    expect(await admin.query(api.people.search, { query: "n" })).toEqual([]);
    const [nino] = await admin.query(api.people.search, { query: " NINO@ex" });
    expect(nino).toMatchObject({ email: "nino@example.com", name: "nino" });
    expect(nino.memberships.map((m) => [m.role, m.universityName?.en])).toEqual([["lecturer", "Gori State"]]);
    expect((await admin.query(api.people.search, { query: "ana" }))[0].memberships[0].role).toBe("student");
    expect(await admin.query(api.people.search, { query: "nobody" })).toEqual([]);
    // Deleted accounts don't show.
    await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "giorgi@example.com")).unique())!;
      await ctx.db.patch("users", user._id, { deletedAt: Date.now() });
    });
    expect(await admin.query(api.people.search, { query: "giorgi" })).toEqual([]);
  });

  test("a lecturer becomes a university admin and back, moves university, or becomes independent", async () => {
    const { t, admin, nino, universityId } = await seed();
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    const [{ memberships }] = await admin.query(api.people.search, { query: "nino@" });
    const membershipId = memberships[0]._id;

    await admin.mutation(api.people.changeStaffRole, { membershipId, role: "uni_admin", universityId });
    expect(await membershipsOf(t, ninoId)).toEqual([{ role: "uni_admin", universityId }]);
    expect((await nino.query(api.universities.listAdministered, {})).map((u) => u._id)).toEqual([universityId]);

    // A university admin always has a university.
    await expectAppError(admin.mutation(api.people.changeStaffRole, { membershipId, role: "uni_admin" }), "INVALID_INPUT");

    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    await admin.mutation(api.people.changeStaffRole, { membershipId, role: "lecturer", universityId: elsewhere });
    expect(await membershipsOf(t, ninoId)).toEqual([{ role: "lecturer", universityId: elsewhere }]);
    await expectAppError(nino.query(api.universities.listAdministered, {}), "FORBIDDEN");

    await admin.mutation(api.people.changeStaffRole, { membershipId, role: "lecturer" });
    expect(await membershipsOf(t, ninoId)).toEqual([{ role: "lecturer", universityId: undefined }]);
    expect(await nino.query(api.users.me, {})).toMatchObject({ isStaff: true });
  });

  test("students and super admins can't be changed here", async () => {
    const { admin, universityId } = await seed();
    const [{ memberships: anaRows }] = await admin.query(api.people.search, { query: "ana@" });
    await expectAppError(
      admin.mutation(api.people.changeStaffRole, { membershipId: anaRows[0]._id, role: "lecturer", universityId }),
      "CONFLICT",
    );
    await expectAppError(admin.mutation(api.people.removeStaffRole, { membershipId: anaRows[0]._id }), "CONFLICT");
    const [{ memberships: adminRows }] = await admin.query(api.people.search, { query: "admin@" });
    const superRow = adminRows.find((m) => m.role === "super_admin")!;
    await expectAppError(admin.mutation(api.people.removeStaffRole, { membershipId: superRow._id }), "CONFLICT");
  });

  test("removing the only staff role ends staff access; courses stay", async () => {
    const { admin, nino, courseId } = await seed();
    const [{ memberships }] = await admin.query(api.people.search, { query: "nino@" });
    await admin.mutation(api.people.removeStaffRole, { membershipId: memberships[0]._id });
    expect(await nino.query(api.users.me, {})).toMatchObject({ isStaff: false });
    await expectAppError(nino.query(api.courses.listMine, {}), "FORBIDDEN");
    expect(await admin.query(api.courses.get, { courseId })).toMatchObject({ title: "Web basics" });
    expect(await admin.query(api.people.search, { query: "nino@" })).toMatchObject([{ memberships: [] }]);
  });

  test("moving away from a university takes them off its groups, but their shared courses stay with students", async () => {
    const { t, admin, nino, maka, universityId, courseId } = await seed();
    const groupId = await admin.mutation(api.groups.create, { name: "ICT-24-1", universityId });
    await nino.mutation(api.groups.joinAsLecturer, { groupId });
    await nino.mutation(api.groups.shareCourse, { groupId, courseId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });

    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const [{ memberships }] = await admin.query(api.people.search, { query: "nino@" });
    await admin.mutation(api.people.changeStaffRole, { membershipId: memberships[0]._id, role: "lecturer", universityId: elsewhere });
    expect((await admin.query(api.groups.get, { groupId })).lecturerList).toEqual([]);
    expect(await maka.query(api.learn.myCourses, {})).toHaveLength(1);
    // A second role at the same university keeps them on its groups.
    const { userId: levanId, membershipId: levanLecturer } = await staffAt(t, "levan", universityId, "lecturer");
    await t.run(async (ctx) => ctx.db.insert("memberships", { userId: levanId, role: "uni_admin", universityId }));
    const levan = t.withIdentity(person("levan"));
    await levan.mutation(api.groups.joinAsLecturer, { groupId });
    await admin.mutation(api.people.removeStaffRole, { membershipId: levanLecturer });
    expect((await admin.query(api.groups.get, { groupId })).lecturerList.map((l) => l.name)).toEqual(["levan"]);
    const [levanFound] = await admin.query(api.people.search, { query: "levan@" });
    expect(levanFound.memberships.map((m) => m.role)).toEqual(["uni_admin"]);
  });

  test("changing a role into one the person already has merges the two", async () => {
    const { t, admin, universityId } = await seed();
    const { userId, membershipId } = await staffAt(t, "levan", universityId, "lecturer");
    await t.run(async (ctx) => ctx.db.insert("memberships", { userId, role: "uni_admin", universityId }));
    await admin.mutation(api.people.changeStaffRole, { membershipId, role: "uni_admin", universityId });
    expect(await membershipsOf(t, userId)).toEqual([{ role: "uni_admin", universityId }]);
  });
});
