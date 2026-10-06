/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { renderAnnouncementEmail } from "./lib/email/templates";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import { announcementPushMessage } from "./lib/pushMessage";
import { expectAppError, person, seed, settle } from "./test.setup";

// The notification center (model/broadcasts.ts): who may send what to whom,
// and what each person gets.

type Env = Awaited<ReturnType<typeof seed>>;
const PAGE = { numItems: 50, cursor: null };

beforeEach(() => {
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("STUDENT_APP_URL", "https://app.kalami.space");
});
afterEach(() => vi.unstubAllEnvs());

const message = {
  title: "Library closed on Friday",
  body: "The main library is closed this Friday.\n\nThe reading rooms stay open.",
  channels: { push: true, email: true },
  emailEveryone: false,
};

/** A university admin at the seeded university. */
async function dean(env: Env) {
  const identity = env.t.withIdentity(person("dean"));
  const userId = await identity.mutation(api.users.store, {});
  await env.t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId, role: "uni_admin", universityId: env.universityId });
  });
  return identity;
}

async function idOf(env: Env, name: string): Promise<Id<"users">> {
  return await env.t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", `${name}@example.com`))
      .unique();
    return user!._id;
  });
}

async function deliveries(env: Env, broadcastId: Id<"broadcasts">) {
  const page = await env.admin.query(api.platform.broadcastRecipients, { broadcastId, paginationOpts: PAGE });
  return new Map(page.page.map((row) => [row.email, row]));
}

describe("notification center: who may send", () => {
  test("students and lecturers are refused; a university admin reaches their own university only", async () => {
    const env = await seed();
    const { t, admin, nino, ana, universityId } = env;
    const audience = { kind: "students" as const, universityId };
    for (const caller of [nino, ana]) {
      await expectAppError(caller.query(api.platform.broadcastPreview, { audience, emailEveryone: false }), "FORBIDDEN");
      await expectAppError(caller.mutation(api.platform.sendBroadcast, { ...message, audience }), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.broadcasts, {}), "FORBIDDEN");
      await expectAppError(caller.query(api.platform.findPeople, { query: "an" }), "FORBIDDEN");
    }
    const tsu = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const tsuGroup = await admin.mutation(api.groups.create, { name: "TSU-1", universityId: tsu });
    const d = await dean(env);
    expect((await d.query(api.platform.broadcastPreview, { audience, emailEveryone: false })).recipients).toBe(3);
    for (const refused of [
      { kind: "everyone" as const },
      { kind: "students" as const },
      { kind: "staff" as const, universityId: "none" as const },
      { kind: "university" as const, universityId: tsu },
    ]) {
      await expectAppError(d.query(api.platform.broadcastPreview, { audience: refused, emailEveryone: false }), "FORBIDDEN");
      await expectAppError(d.mutation(api.platform.sendBroadcast, { ...message, audience: refused }), "FORBIDDEN");
    }
    await expectAppError(
      d.query(api.platform.broadcastPreview, { audience: { kind: "group", groupId: tsuGroup }, emailEveryone: false }),
      "NOT_FOUND",
    );
    // The platform admin's own account is outside every university: not the dean's to message.
    await expectAppError(
      d.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "people", userIds: [await idOf(env, "admin")] } }),
      "NOT_FOUND",
    );
    await expectAppError(t.query(api.platform.broadcasts, {}), "UNAUTHENTICATED");
  });

  test("the message itself is checked", async () => {
    const env = await seed();
    const audience = { kind: "students" as const, universityId: env.universityId };
    await expectAppError(env.admin.mutation(api.platform.sendBroadcast, { ...message, audience, title: "  " }), "INVALID_INPUT");
    await expectAppError(env.admin.mutation(api.platform.sendBroadcast, { ...message, audience, body: "" }), "INVALID_INPUT");
    await expectAppError(
      env.admin.mutation(api.platform.sendBroadcast, { ...message, audience, link: "javascript:alert(1)" }),
      "INVALID_INPUT",
    );
    await expectAppError(
      env.admin.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "people", userIds: [] } }),
      "INVALID_INPUT",
    );
  });
});

describe("notification center: sending", () => {
  test("everyone: students get the bell and the email, staff the email; a repeated batch sends nothing twice", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const env = await seed();
    const { t, admin, ana, nino } = env;
    const broadcastId = await admin.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "everyone" } });
    await settle(t);

    const [row] = await admin.query(api.platform.broadcasts, {});
    expect(row).toMatchObject({
      _id: broadcastId,
      title: message.title,
      audienceLabel: "Everyone on Kalami",
      from: { ka: "კალამი", en: "Kalami" },
      status: "sent",
      recipients: 5,
      inApp: 3,
      pushed: 0,
      emailed: 5,
      senderName: "admin",
    });
    expect(row.finishedAt).toBeDefined();

    const inbox = await ana.query(api.notifications.inbox, {});
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      kind: "announcement",
      title: message.title,
      body: message.body,
      courseTitle: "კალამი",
      href: "/dashboard",
      read: false,
    });
    expect(inbox.items[0].assessmentKind).toBeUndefined();
    // The lecturer has no bell: nothing was written for them.
    const ninoId = await idOf(env, "nino");
    const ninoRows = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_userId", (q) => q.eq("userId", ninoId))
        .take(10),
    );
    expect(ninoRows).toHaveLength(0);

    const got = await deliveries(env, broadcastId);
    expect(got.size).toBe(5);
    expect(got.get("nino@example.com")).toMatchObject({ role: "lecturer", inApp: false, devices: 0, emailed: true });
    expect(got.get("ana@example.com")).toMatchObject({ name: "ana S", role: "student", inApp: true, devices: 0, emailed: true });
    expect(got.get("admin@example.com")).toMatchObject({ role: "super_admin", inApp: false, emailed: true });

    const audit = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("auditLog")
          .withIndex("by_targetTable", (q) => q.eq("targetTable", "broadcasts"))
          .take(10)
      ).filter((entry) => entry.action === "broadcast.send"),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toBe('Sent "Library closed on Friday" to Everyone on Kalami');

    // The first batch runs again (a retried scheduled function): everyone already has a delivery row.
    await t.run(async (ctx) => {
      await ctx.db.patch("broadcasts", broadcastId, { status: "sending" });
    });
    await t.mutation(internal.broadcasts.fanOut, { broadcastId, phase: 0, cursor: null });
    await settle(t);
    const [again] = await admin.query(api.platform.broadcasts, {});
    expect(again).toMatchObject({ status: "sent", recipients: 5, inApp: 3, emailed: 5 });
    expect((await ana.query(api.notifications.inbox, {})).items).toHaveLength(1);
    expect((await deliveries(env, broadcastId)).size).toBe(5);
    void nino;
  });

  test("a group, a course, and people picked one by one", async () => {
    const env = await seed();
    const { t, admin, nino, ana, maka, universityId, courseId } = env;
    const groupId = await admin.mutation(api.groups.create, { name: "ICT-24-1", universityId });
    await nino.mutation(api.groups.joinAsLecturer, { groupId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await ana.mutation(api.groups.join, { code: inviteCode });
    await maka.mutation(api.groups.join, { code: inviteCode });

    const toGroup = await admin.mutation(api.platform.sendBroadcast, {
      ...message,
      channels: { push: false, email: false },
      link: "/courses/abc",
      audience: { kind: "group", groupId },
    });
    const toCourse = await admin.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "course", courseId } });
    const anaId = await idOf(env, "ana");
    const toPeople = await admin.mutation(api.platform.sendBroadcast, {
      ...message,
      audience: { kind: "people", userIds: [anaId, await idOf(env, "nino"), anaId] },
    });
    await settle(t);

    const rows = new Map((await admin.query(api.platform.broadcasts, {})).map((row) => [row._id, row]));
    expect(rows.get(toGroup)).toMatchObject({ audienceLabel: "Group ICT-24-1 (Gori State)", recipients: 2, inApp: 2, pushed: 0, emailed: 0 });
    expect(rows.get(toCourse)).toMatchObject({ audienceLabel: "Course Web basics", recipients: 2, inApp: 2 });
    expect(rows.get(toPeople)).toMatchObject({ audienceLabel: "ana S, nino", recipients: 2, inApp: 1 });

    const group = await deliveries(env, toGroup);
    expect([...group.keys()].sort()).toEqual(["ana@example.com", "maka@example.com"]);
    expect(group.get("ana@example.com")).toMatchObject({ inApp: true, emailed: false, emailSkipped: "off" });
    expect([...(await deliveries(env, toCourse)).keys()].sort()).toEqual(["ana@example.com", "giorgi@example.com"]);

    const inbox = await ana.query(api.notifications.inbox, {});
    expect(inbox.items.map((item) => item.href)).toEqual(["/dashboard", "/dashboard", "/courses/abc"]);
    expect((await maka.query(api.notifications.inbox, {})).items).toHaveLength(1);
  });

  test("email rules: switched off, bounced, and the override; pushes count devices", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const env = await seed();
    const { t, admin, ana, giorgi, universityId } = env;
    const d = await dean(env);
    await ana.mutation(api.notifications.setEmailPreference, { enabled: false });
    await ana.mutation(api.push.subscribe, { endpoint: "https://push.example.com/sub/ana", keys: { p256dh: "k", auth: "a" } });
    // Looked up first: a t.run inside another t.run never returns.
    const giorgiId = await idOf(env, "giorgi");
    await t.run(async (ctx) => {
      await ctx.db.patch("users", giorgiId, { emailStatus: "bounced" });
    });
    const audience = { kind: "students" as const, universityId };

    expect(await d.query(api.platform.broadcastPreview, { audience, emailEveryone: false })).toEqual({
      recipients: 3,
      students: 3,
      staff: 0,
      noAccount: 0,
      withPush: 1,
      emailable: 1,
      optedOut: 1,
      blocked: 1,
      capped: false,
      emailConfigured: true,
      pushConfigured: false,
    });
    expect(await d.query(api.platform.broadcastPreview, { audience, emailEveryone: true })).toMatchObject({ emailable: 2, optedOut: 0, blocked: 1 });

    const first = await d.mutation(api.platform.sendBroadcast, { ...message, audience });
    await settle(t);
    const [row] = await d.query(api.platform.broadcasts, {});
    expect(row).toMatchObject({
      _id: first,
      audienceLabel: "All students at Gori State",
      from: { ka: "გორი", en: "Gori State" },
      recipients: 3,
      inApp: 3,
      pushed: 1,
      emailed: 1,
    });
    expect((await ana.query(api.notifications.inbox, {})).items[0].courseTitle).toBe("გორი");
    const got = await deliveries(env, first);
    expect(got.get("ana@example.com")).toMatchObject({ devices: 1, emailed: false, emailSkipped: "opted_out" });
    expect(got.get("giorgi@example.com")).toMatchObject({ devices: 0, emailed: false, emailSkipped: "blocked" });
    expect(got.get("maka@example.com")).toMatchObject({ emailed: true });

    const second = await d.mutation(api.platform.sendBroadcast, { ...message, audience, emailEveryone: true });
    await settle(t);
    const again = await deliveries(env, second);
    expect(again.get("ana@example.com")).toMatchObject({ emailed: true });
    expect(again.get("giorgi@example.com")).toMatchObject({ emailed: false, emailSkipped: "blocked" });

    // The dean sees their own messages; the platform admin sees everyone's; the dean can't open the admin's.
    const byAdmin = await admin.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "everyone" } });
    await settle(t);
    expect((await d.query(api.platform.broadcasts, {})).map((r) => r._id).sort()).toEqual([first, second].sort());
    expect(await admin.query(api.platform.broadcasts, {})).toHaveLength(3);
    await expectAppError(d.query(api.platform.broadcastRecipients, { broadcastId: byAdmin, paginationOpts: PAGE }), "NOT_FOUND");
    void giorgi;
  });

  test("without email set up nothing is emailed, and the recipient list says so", async () => {
    const env = await seed();
    const { t, admin, universityId } = env;
    const audience = { kind: "staff" as const, universityId };
    expect(await admin.query(api.platform.broadcastPreview, { audience, emailEveryone: false })).toMatchObject({
      recipients: 1,
      staff: 1,
      emailConfigured: false,
    });
    const broadcastId = await admin.mutation(api.platform.sendBroadcast, { ...message, audience });
    await settle(t);
    const [row] = await admin.query(api.platform.broadcasts, {});
    expect(row).toMatchObject({ audienceLabel: "All lecturers and admins at Gori State", recipients: 1, inApp: 0, emailed: 0, status: "sent" });
    expect((await deliveries(env, broadcastId)).get("nino@example.com")).toMatchObject({ emailed: false, emailSkipped: "not_configured" });
  });

  test("finding people to pick: by email, within reach", async () => {
    const env = await seed();
    const { t, admin, universityId } = env;
    const tsu = await admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
    const anka = t.withIdentity(person("anka"));
    await anka.mutation(api.users.store, {});
    await anka.mutation(api.users.completeStudentOnboarding, {
      firstName: "Anka",
      lastName: "T",
      universityId: tsu,
      faculty: "Law",
      group: "L-1",
      year: 2,
      locale: "en",
      honestyVersion: HONESTY_NOTICE.version,
    });
    const d = await dean(env);
    expect((await admin.query(api.platform.findPeople, { query: "an" })).map((hit) => hit.email).sort()).toEqual([
      "ana@example.com",
      "anka@example.com",
    ]);
    expect(await d.query(api.platform.findPeople, { query: "an" })).toMatchObject([
      { email: "ana@example.com", name: "ana S", roles: ["student"], universityName: { ka: "გორი", en: "Gori State" } },
    ]);
    expect((await d.query(api.platform.findPeople, { query: "ni" })).map((hit) => hit.roles)).toEqual([["lecturer"]]);
    expect(await d.query(api.platform.findPeople, { query: "a" })).toEqual([]);
    void universityId;
  });
});

describe("announcement texts", () => {
  test("the email: paragraphs, a button only with a link, everything escaped", () => {
    const withLink = renderAnnouncementEmail({
      locale: "en",
      firstName: "Ana",
      from: "Gori State University",
      title: "Exam week <b>",
      body: "First paragraph\nstill the first.\n\nSecond one.",
      url: "https://app.kalami.space/courses/x",
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?u=1&t=2",
    });
    expect(withLink.subject).toBe("Exam week <b>");
    expect(withLink.html).toContain("Exam week &lt;b&gt;");
    expect(withLink.html).not.toContain("<b>");
    expect(withLink.text).toContain("Hi Ana,");
    expect(withLink.text).toContain("First paragraph still the first.");
    expect(withLink.text).toContain("Second one.");
    expect(withLink.text).toContain("Open in Kalami: https://app.kalami.space/courses/x");
    expect(withLink.text).toContain("Sent by Gori State University");

    const plain = renderAnnouncementEmail({
      locale: "ka",
      from: "კალამი",
      title: "შეტყობინება",
      body: "ტექსტი",
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?u=1&t=2",
    });
    expect(plain.text).toContain("გამარჯობა!");
    expect(plain.html).not.toContain("გახსნა კალამში");
    expect(plain.text).toContain("შეტყობინებების გამორთვა: https://backend.convex.site/email/unsubscribe?u=1&t=2");
  });

  test("the push: the title as written, the text cut short, the link resolved", () => {
    const push = announcementPushMessage({
      notificationId: "n1",
      locale: "en",
      title: "Library closed",
      body: `${"word ".repeat(50)}end`,
      href: "/dashboard",
      studentAppUrl: "https://app.kalami.space/",
    });
    expect(push.title).toBe("Library closed");
    expect(push.body.length).toBeLessThanOrEqual(160);
    expect(push.body.endsWith("…")).toBe(true);
    expect(push.url).toBe("https://app.kalami.space/dashboard");
    expect(push.tag).toBe("notification:n1");
    expect(announcementPushMessage({ notificationId: "n2", locale: "ka", title: "t", body: "b", href: "https://example.com/x", studentAppUrl: "https://app.kalami.space" }).url).toBe(
      "https://example.com/x",
    );
  });
});
