/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireStudent } from "./lib/auth";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://test.clerk.accounts.dev";

/** A Clerk session. Claims a user has no value for arrive as null, hence `unknown`. */
function person(name: string, claims: Record<string, unknown> = {}): Partial<UserIdentity> {
  return {
    issuer: ISSUER,
    subject: name,
    tokenIdentifier: `${ISSUER}|${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    givenName: name,
    ...claims,
  } as Partial<UserIdentity>;
}

async function expectAppError(call: Promise<unknown>, code: string) {
  try {
    await call;
  } catch (error) {
    expect((error as { data?: { code?: string } }).data?.code).toBe(code);
    return;
  }
  throw new Error(`Expected a ${code} error, but the call succeeded`);
}

/** A fresh backend with a super admin and one university. */
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const universityId = await admin.mutation(api.universities.create, {
    nameKa: "სატესტო უნივერსიტეტი",
    nameEn: "Test University",
    slug: "test-uni",
  });
  return { t, admin, universityId };
}

function onboardingArgs(universityId: Id<"universities">) {
  return {
    firstName: "ანა",
    lastName: "ბერიძე",
    universityId,
    faculty: "Computer Science",
    group: "CS-101",
    year: 2,
    locale: "ka" as const,
    honestyVersion: HONESTY_NOTICE.version,
  };
}

describe("users", () => {
  test("store keeps one row per identity and follows email changes", async () => {
    const t = convexTest(schema, modules);
    const ana = t.withIdentity(person("ana"));
    const first = await ana.mutation(api.users.store, {});
    expect(await ana.mutation(api.users.store, {})).toBe(first);

    const renamed = t.withIdentity(person("ana", { email: " Ana.New@Example.com " }));
    expect(await renamed.mutation(api.users.store, {})).toBe(first);
    expect((await renamed.query(api.users.me, {}))?.email).toBe("ana.new@example.com");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("null claims are treated as missing", async () => {
    const t = convexTest(schema, modules);
    const nameless = t.withIdentity(
      person("nameless", { givenName: null, familyName: null, pictureUrl: null }),
    );
    await nameless.mutation(api.users.store, {});
    const me = await nameless.query(api.users.me, {});
    expect(me?.firstName).toBeUndefined();
    expect(me?.avatarUrl).toBeUndefined();
  });

  test("a token without an email claim is rejected loudly", async () => {
    const t = convexTest(schema, modules);
    await expectAppError(
      t.withIdentity(person("ghost", { email: null })).mutation(api.users.store, {}),
      "MISSING_EMAIL_CLAIM",
    );
  });

  test("signed-out callers get null from me and errors elsewhere", async () => {
    const { t } = await setup();
    expect(await t.query(api.users.me, {})).toBeNull();
    await expectAppError(t.mutation(api.users.store, {}), "UNAUTHENTICATED");
    await expectAppError(t.query(api.universities.listActive, {}), "UNAUTHENTICATED");
  });

  test("the honesty notice is readable without signing in", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(api.honesty.current, {})).version).toBe(HONESTY_NOTICE.version);
  });
});

describe("student onboarding", () => {
  test("creates exactly one student membership and clears needsOnboarding", async () => {
    const { t, universityId } = await setup();
    const ana = t.withIdentity(person("ana"));
    await ana.mutation(api.users.store, {});
    expect((await ana.query(api.users.me, {}))?.needsOnboarding).toBe(true);
    expect(await ana.query(api.universities.listActive, {})).toHaveLength(1);

    await ana.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));
    expect(await ana.query(api.users.me, {})).toMatchObject({
      firstName: "ანა",
      isStaff: false,
      honestyAccepted: true,
      needsOnboarding: false,
      student: { universityId, group: "CS-101", year: 2 },
    });

    await ana.mutation(api.users.completeStudentOnboarding, {
      ...onboardingArgs(universityId),
      group: "CS-102",
    });
    const students = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_universityId_and_role", (q) =>
          q.eq("universityId", universityId).eq("role", "student"),
        )
        .collect(),
    );
    expect(students).toHaveLength(1);
    expect(students[0].group).toBe("CS-102");
  });

  test("rejects an outdated honesty notice and invalid input", async () => {
    const { t, universityId } = await setup();
    const ana = t.withIdentity(person("ana"));
    const args = onboardingArgs(universityId);
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, { ...args, honestyVersion: 0 }),
      "CONFLICT",
    );
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, { ...args, year: 9 }),
      "INVALID_INPUT",
    );
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, { ...args, firstName: "   " }),
      "INVALID_INPUT",
    );
  });

  test("a student can't switch university by re-submitting onboarding", async () => {
    const { t, admin, universityId } = await setup();
    const otherUniversityId = await admin.mutation(api.universities.create, {
      nameKa: "სხვა უნივერსიტეტი",
      nameEn: "Other University",
      slug: "other-uni",
    });
    const ana = t.withIdentity(person("ana"));
    await ana.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));
    await expectAppError(
      ana.mutation(api.users.completeStudentOnboarding, {
        ...onboardingArgs(universityId),
        universityId: otherUniversityId,
      }),
      "FORBIDDEN",
    );
    expect((await ana.query(api.users.me, {}))?.student?.universityId).toBe(universityId);
  });

  test("requireStudent wants a finished onboarding and the current notice", async () => {
    const { t, admin, universityId } = await setup();
    const ana = t.withIdentity(person("ana"));
    await ana.mutation(api.users.store, {});
    await expectAppError(ana.run((ctx) => requireStudent(ctx)), "FORBIDDEN");

    await ana.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));
    expect((await ana.run((ctx) => requireStudent(ctx))).universityId).toBe(universityId);

    // A newer notice locks the student out until they accept it again.
    const anaId = (await ana.query(api.users.me, {}))!._id;
    await t.run((ctx) => ctx.db.patch("users", anaId, { honestyVersion: HONESTY_NOTICE.version - 1 }));
    await expectAppError(ana.run((ctx) => requireStudent(ctx)), "FORBIDDEN");
    expect((await ana.query(api.users.me, {}))?.needsOnboarding).toBe(true);

    await expectAppError(admin.run((ctx) => requireStudent(ctx)), "FORBIDDEN");
  });

  test("staff accounts can't become students", async () => {
    const { t, admin, universityId } = await setup();
    const { token } = await admin.mutation(api.invites.create, {
      universityId,
      email: "nino@example.com",
      role: "lecturer",
    });
    const nino = t.withIdentity(person("nino"));
    await nino.mutation(api.invites.accept, { token });
    await expectAppError(
      nino.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId)),
      "FORBIDDEN",
    );
    await expectAppError(nino.run((ctx) => requireStudent(ctx)), "FORBIDDEN");
    expect((await nino.query(api.users.me, {}))?.needsOnboarding).toBe(false);
  });

  test("the super admin is exempt from the student/staff split", async () => {
    const { admin, universityId } = await setup();
    expect((await admin.query(api.users.me, {}))?.needsOnboarding).toBe(true);

    await admin.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));
    expect(await admin.query(api.users.me, {})).toMatchObject({
      isSuperAdmin: true,
      isStaff: true,
      needsOnboarding: false,
      student: { universityId },
    });
    expect((await admin.run((ctx) => requireStudent(ctx))).universityId).toBe(universityId);

    // Still every admin power, and invites still work despite the student profile.
    const otherUniversityId = await admin.mutation(api.universities.create, {
      nameKa: "სხვა",
      nameEn: "Other",
      slug: "other",
    });
    const { token } = await admin.mutation(api.invites.create, {
      universityId: otherUniversityId,
      email: "admin@example.com",
      role: "uni_admin",
    });
    await admin.mutation(api.invites.accept, { token });
    expect((await admin.query(api.users.me, {}))?.memberships).toHaveLength(3);
  });
});

describe("role checks", () => {
  test("students are locked out of staff and admin functions", async () => {
    const { t, universityId } = await setup();
    const ana = t.withIdentity(person("ana"));
    await ana.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));

    await expectAppError(
      ana.mutation(api.universities.create, { nameKa: "ა", nameEn: "A", slug: "a" }),
      "FORBIDDEN",
    );
    await expectAppError(ana.query(api.universities.listAdministered, {}), "FORBIDDEN");
    await expectAppError(
      ana.mutation(api.invites.create, { universityId, email: "ana@example.com", role: "lecturer" }),
      "FORBIDDEN",
    );
    await expectAppError(ana.query(api.invites.listForUniversity, { universityId }), "FORBIDDEN");
  });

  test("the super admin bootstrap is internal and idempotent", async () => {
    const { t } = await setup();
    expect(await t.mutation(internal.admin.grantSuperAdmin, { email: "ADMIN@example.com" })).toBe(
      "admin@example.com is already a super admin.",
    );
    await expect(
      t.mutation(internal.admin.grantSuperAdmin, { email: "nobody@example.com" }),
    ).rejects.toThrow(/No user with email/);
  });

  test("student accounts can't accept staff invites, but the CLI can promote anyone", async () => {
    const { t, admin, universityId } = await setup();
    const ana = t.withIdentity(person("ana"));
    await ana.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId));

    const { token } = await admin.mutation(api.invites.create, {
      universityId,
      email: "ana@example.com",
      role: "lecturer",
    });
    await expectAppError(ana.mutation(api.invites.accept, { token }), "CONFLICT");
    expect(await ana.query(api.users.me, {})).toMatchObject({ isStaff: false, needsOnboarding: false });

    expect(await t.mutation(internal.admin.grantSuperAdmin, { email: "ana@example.com" })).toBe(
      "ana@example.com is now a super admin.",
    );
    expect(await ana.query(api.users.me, {})).toMatchObject({
      isSuperAdmin: true,
      student: { universityId },
      needsOnboarding: false,
    });
  });
});

describe("invites", () => {
  test("a lecturer joins through an invite sent to their email", async () => {
    const { t, admin, universityId } = await setup();
    const { token } = await admin.mutation(api.invites.create, {
      universityId,
      email: " Nino@Example.com ",
      role: "lecturer",
    });
    expect(await t.query(api.invites.getByToken, { token })).toMatchObject({
      email: "nino@example.com",
      role: "lecturer",
      status: "pending",
    });

    // Accepting creates the user row too, so it works before `store` has run.
    const nino = t.withIdentity(person("nino"));
    expect(await nino.mutation(api.invites.accept, { token })).toEqual({
      universityId,
      role: "lecturer",
    });
    expect(await nino.mutation(api.invites.accept, { token })).toEqual({
      universityId,
      role: "lecturer",
    });
    expect(await nino.query(api.users.me, {})).toMatchObject({
      isStaff: true,
      needsOnboarding: false,
    });
    expect((await t.query(api.invites.getByToken, { token }))?.status).toBe("accepted");

    const lecturers = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_universityId_and_role", (q) =>
          q.eq("universityId", universityId).eq("role", "lecturer"),
        )
        .collect(),
    );
    expect(lecturers).toHaveLength(1);
    await expectAppError(
      nino.mutation(api.users.completeStudentOnboarding, onboardingArgs(universityId)),
      "FORBIDDEN",
    );
  });

  test("only the invited, verified email can accept, and only once", async () => {
    const { t, admin, universityId } = await setup();
    const { token } = await admin.mutation(api.invites.create, {
      universityId,
      email: "nino@example.com",
      role: "lecturer",
    });

    await expectAppError(
      t.withIdentity(person("eve")).mutation(api.invites.accept, { token }),
      "FORBIDDEN",
    );
    for (const emailVerified of [false, null, undefined]) {
      await expectAppError(
        t
          .withIdentity(person("nino-unverified", { email: "nino@example.com", emailVerified }))
          .mutation(api.invites.accept, { token }),
        "FORBIDDEN",
      );
    }

    await t.withIdentity(person("nino")).mutation(api.invites.accept, { token });
    await expectAppError(
      t
        .withIdentity(person("nino-second-account", { email: "nino@example.com" }))
        .mutation(api.invites.accept, { token }),
      "CONFLICT",
    );
    expect(await t.query(api.invites.getByToken, { token: "not-a-real-token" })).toBeNull();
  });

  test("expired and revoked invites can't be accepted", async () => {
    const { t, admin, universityId } = await setup();
    const late = await admin.mutation(api.invites.create, {
      universityId,
      email: "late@example.com",
      role: "lecturer",
    });
    await t.run((ctx) => ctx.db.patch("invites", late.inviteId, { expiresAt: Date.now() - 1 }));
    await expectAppError(
      t.withIdentity(person("late")).mutation(api.invites.accept, { token: late.token }),
      "EXPIRED",
    );

    const gone = await admin.mutation(api.invites.create, {
      universityId,
      email: "gone@example.com",
      role: "lecturer",
    });
    await admin.mutation(api.invites.revoke, { inviteId: gone.inviteId });
    expect((await t.query(api.invites.getByToken, { token: gone.token }))?.status).toBe("revoked");
    await expectAppError(
      t.withIdentity(person("gone")).mutation(api.invites.accept, { token: gone.token }),
      "NOT_FOUND",
    );
  });

  test("university admins invite lecturers to their own university only", async () => {
    const { t, admin, universityId } = await setup();
    const otherUniversityId = await admin.mutation(api.universities.create, {
      nameKa: "სხვა უნივერსიტეტი",
      nameEn: "Other University",
      slug: "other-uni",
    });
    const { token } = await admin.mutation(api.invites.create, {
      universityId,
      email: "dean@example.com",
      role: "uni_admin",
    });
    const dean = t.withIdentity(person("dean"));
    await dean.mutation(api.invites.accept, { token });

    const { inviteId } = await dean.mutation(api.invites.create, {
      universityId,
      email: "lecturer@example.com",
      role: "lecturer",
    });
    // Newest first: the pending lecturer invite carries its link, the used admin invite doesn't.
    const [lecturerInvite, deanInvite] = await dean.query(api.invites.listForUniversity, {
      universityId,
    });
    expect(lecturerInvite.token).toEqual(expect.any(String));
    expect(deanInvite.token).toBeUndefined();
    expect((await dean.query(api.universities.listAdministered, {})).map((u) => u._id)).toEqual([
      universityId,
    ]);
    await dean.mutation(api.invites.revoke, { inviteId });
    const [withdrawn] = await dean.query(api.invites.listForUniversity, { universityId });
    expect(withdrawn.token).toBeUndefined();

    // Pending admin invites stay hidden from university admins.
    await admin.mutation(api.invites.create, {
      universityId,
      email: "second-dean@example.com",
      role: "uni_admin",
    });
    const [pendingAdminInvite] = await dean.query(api.invites.listForUniversity, { universityId });
    expect(pendingAdminInvite.role).toBe("uni_admin");
    expect(pendingAdminInvite.token).toBeUndefined();

    await expectAppError(
      dean.mutation(api.invites.create, { universityId, email: "x@example.com", role: "uni_admin" }),
      "FORBIDDEN",
    );
    await expectAppError(
      dean.mutation(api.invites.create, {
        universityId: otherUniversityId,
        email: "y@example.com",
        role: "lecturer",
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      dean.query(api.invites.listForUniversity, { universityId: otherUniversityId }),
      "FORBIDDEN",
    );
    await expectAppError(
      dean.mutation(api.universities.create, { nameKa: "ბ", nameEn: "B", slug: "b" }),
      "FORBIDDEN",
    );
  });
});
