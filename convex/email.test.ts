/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { recordEmailStatus } from "./email";
import { renderNotificationEmail, renderStaffInviteEmail } from "./lib/email/templates";
import { formatTbilisi } from "./lib/email/time";
import { unsubscribeToken } from "./lib/tokens";
import { expectAppError, person, seed, settle } from "./test.setup";

beforeEach(() => {
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("STUDENT_APP_URL", "https://app.kalami.space");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email templates", () => {
  test("Georgian and English, with the deadline in Tbilisi time and no raw HTML from titles", () => {
    const dueAt = Date.UTC(2026, 9, 6, 14, 0); // 18:00 in Tbilisi
    const ka = renderNotificationEmail({
      locale: "ka",
      firstName: "ანა",
      kind: "published",
      assessmentKind: "quiz",
      title: "კვირა 1 <script>",
      courseTitle: "ვებ ტექნოლოგიები",
      dueAt,
      url: "https://app.kalami.space/quizzes/x",
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?u=1&t=2",
    });
    expect(ka.subject).toBe("ახალი ქვიზი: კვირა 1 <script>");
    expect(ka.html).toContain("&lt;script&gt;");
    expect(ka.html).not.toContain("<script>");
    expect(ka.html).toContain("სამ, 6 ოქტ, 18:00");
    expect(ka.text).toContain("გახსნა კალამში: https://app.kalami.space/quizzes/x");
    expect(ka.text).toContain("გამორთვა: https://backend.convex.site/email/unsubscribe?u=1&t=2");

    const en = renderNotificationEmail({
      locale: "en",
      kind: "due_1h",
      assessmentKind: "final",
      title: "Final",
      courseTitle: "Web basics",
      dueAt,
      url: "https://app.kalami.space/quizzes/y",
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?u=1&t=2",
    });
    expect(en.subject).toBe("One hour left: Final");
    expect(en.text).toContain("Hi,");
    expect(en.text).toContain("Deadline: Tue, 6 Oct, 18:00 (Tbilisi time)");
    expect(en.text).toContain("If you have already submitted it, you can ignore this.");
    // The link is written out too, for when the button doesn't work.
    expect(en.html).toContain(">https://app.kalami.space/quizzes/y</a>");
    expect(formatTbilisi(Date.UTC(2026, 0, 1, 0, 0), "en")).toBe("Thu, 1 Jan, 04:00");
  });

  test("a staff invitation says who, where and until when, in Georgian then English, escaped", () => {
    const email = renderStaffInviteEmail({
      inviterName: "Gio <b>",
      role: "lecturer",
      universityName: { ka: "გორის უნივერსიტეტი", en: "Gori University" },
      email: "nino@gsu.edu.ge",
      url: "https://staff.kalami.space/invite/abc",
      expiresAt: Date.UTC(2026, 9, 19, 14, 0),
    });
    expect(email.subject).toContain("Gio <b> invited you to teach on Kalami");
    expect(email.html).toContain("Gio &lt;b&gt;");
    expect(email.html).not.toContain("<b>");
    expect(email.html.indexOf('lang="ka"')).toBeLessThan(email.html.indexOf('lang="en"'));
    for (const part of ["გორის უნივერსიტეტი", "Gori University", "nino@gsu.edu.ge", "ლექტორი", "Lecturer", "Mon, 19 Oct, 18:00 (Tbilisi time)"]) {
      expect(email.html).toContain(part);
    }
    expect(email.text).toContain("Accept invitation: https://staff.kalami.space/invite/abc");
    expect(email.text).toContain("მოწვევის მიღება: https://staff.kalami.space/invite/abc");
    const independent = renderStaffInviteEmail({
      inviterName: "Gio",
      role: "lecturer",
      email: "tutor@gmail.com",
      url: "https://staff.kalami.space/invite/def",
      expiresAt: Date.UTC(2026, 9, 19, 14, 0),
    });
    expect(independent.text).toContain("University: Independent teacher");
  });
});

describe("staff invitations by email", () => {
  test("creating an invite emails its link once; asking again soon doesn't resend, later it does", async () => {
    const { t, admin, universityId } = await seed();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("STAFF_APP_URL", "https://staff.kalami.space");
    const first = await admin.mutation(api.invites.create, { universityId, email: "Levan@Example.com", role: "lecturer" });
    expect(first.email).toBe("sent");
    const row = await t.run(async (ctx) => ctx.db.get("invites", first.inviteId));
    expect(row?.emailedAt).toBeDefined();
    const logged = await t.run(async (ctx) => ctx.db.query("emailLog").collect());
    expect(logged.map((entry) => entry.email)).toEqual(["levan@example.com"]);

    // The same person again: same link, and no second email within ten minutes.
    const again = await admin.mutation(api.invites.create, { universityId, email: "levan@example.com", role: "lecturer" });
    expect(again).toMatchObject({ inviteId: first.inviteId, token: first.token, email: "recent" });
    expect(await admin.mutation(api.invites.resendEmail, { inviteId: first.inviteId })).toBe("recent");

    // Later (and expired by then): the resend renews the invite and sends it.
    await t.run(async (ctx) => ctx.db.patch("invites", first.inviteId, { emailedAt: Date.now() - 11 * 60_000, expiresAt: Date.now() - 1 }));
    expect(await admin.mutation(api.invites.resendEmail, { inviteId: first.inviteId })).toBe("sent");
    const renewed = await t.run(async (ctx) => ctx.db.get("invites", first.inviteId));
    expect(renewed!.expiresAt).toBeGreaterThan(Date.now());
    expect((await admin.query(api.invites.listAll, {}))[0].emailedAt).toBeDefined();

    // Accepted invites aren't resent.
    await t.withIdentity({ ...person("levan") }).mutation(api.invites.accept, { token: first.token });
    await expectAppError(admin.mutation(api.invites.resendEmail, { inviteId: first.inviteId }), "CONFLICT");
  });

  test("without email set up, or to an address that bounced, the invite is created but not emailed", async () => {
    const { t, admin, universityId } = await seed();
    const off = await admin.mutation(api.invites.create, { universityId, email: "a@example.com", role: "lecturer" });
    expect(off.email).toBe("off");
    expect((await t.run(async (ctx) => ctx.db.get("invites", off.inviteId)))?.emailedAt).toBeUndefined();

    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await t.run(async (ctx) => {
      await ctx.db.insert("emailSuppressions", { email: "bounced@example.com", status: "bounced", at: Date.now() });
    });
    expect((await admin.mutation(api.invites.create, { universityId, email: "bounced@example.com", role: "lecturer" })).email).toBe("off");
  });

  test("a university admin resends their lecturers' invites, not admin invites or other universities'", async () => {
    const { t, admin, universityId } = await seed();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const deanInvite = await admin.mutation(api.invites.create, { universityId, email: "dean@example.com", role: "uni_admin" });
    const dean = t.withIdentity(person("dean"));
    await dean.mutation(api.invites.accept, { token: deanInvite.token });
    const lecturer = await dean.mutation(api.invites.create, { universityId, email: "l@example.com", role: "lecturer" });
    expect(lecturer.email).toBe("sent");
    const second = await admin.mutation(api.invites.create, { universityId, email: "dean2@example.com", role: "uni_admin" });
    await expectAppError(dean.mutation(api.invites.resendEmail, { inviteId: second.inviteId }), "FORBIDDEN");
    const elsewhere = await admin.mutation(api.universities.create, { nameKa: "ბ", nameEn: "B", slug: "b" });
    const foreign = await admin.mutation(api.invites.create, { universityId: elsewhere, email: "f@example.com", role: "lecturer" });
    await expectAppError(dean.mutation(api.invites.resendEmail, { inviteId: foreign.inviteId }), "FORBIDDEN");
  });
});

describe("email delivery", () => {
  test("a published quiz emails the students who want emails, once, with an unsubscribe link that works", async () => {
    const { t, nino, ana, giorgi, quiz } = await seed();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    // Giorgi switched emails off in the app.
    await giorgi.mutation(api.notifications.setEmailPreference, { enabled: false });
    expect((await giorgi.query(api.notifications.inbox, {})).emailEnabled).toBe(false);

    const { assessmentId } = await quiz("Quiz 1", { closesAt: Date.now() + 48 * 3_600_000 });
    void assessmentId;
    const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const anaId = (await ana.query(api.users.me, {}))!._id;
    const giorgiId = (await giorgi.query(api.users.me, {}))!._id;
    expect(byUser.get(anaId)?.emailId).toBeDefined();
    expect(byUser.get(giorgiId)?.emailId).toBeUndefined();

    // The queued email carries the one-click unsubscribe headers and our idempotency key.
    const queued = await t.run(async (ctx) => ctx.db.get("notifications", byUser.get(anaId)!._id));
    expect(queued?.emailedAt).toBeDefined();
    // Running delivery again for the same rows queues nothing new.
    expect(await t.mutation(internal.email.deliver, { notificationIds: rows.map((r) => r._id) })).toBe(0);

    // The link in the email: a forged token does nothing, the real one switches emails off.
    const token = (await unsubscribeToken(anaId))!;
    const bad = await t.fetch(`/email/unsubscribe?u=${anaId}&t=${token.slice(0, -2)}xx`, { method: "POST" });
    expect(bad.status).toBe(404);
    expect((await ana.query(api.notifications.inbox, {})).emailEnabled).toBe(true);
    const ask = await t.fetch(`/email/unsubscribe?u=${anaId}&t=${token}`, { method: "GET" });
    expect(ask.status).toBe(200);
    expect(await ask.text()).toContain("Stop Kalami notification emails?");
    const done = await t.fetch(`/email/unsubscribe?u=${anaId}&t=${token}`, { method: "POST" });
    expect(done.status).toBe(200);
    expect((await ana.query(api.notifications.inbox, {})).emailEnabled).toBe(false);

    // A second quiz: Ana gets the bell notification but no email now.
    await quiz("Quiz 2");
    const later = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    const anaRows = later.filter((row) => row.userId === anaId);
    expect(anaRows).toHaveLength(2);
    expect(anaRows.filter((row) => row.emailId !== undefined)).toHaveLength(1);
    void nino;
  });

  test("without an API key nothing is queued, and a bounced address stops further emails", async () => {
    const { t, ana, quiz } = await seed();
    await quiz("Quiz 1");
    const anaId = (await ana.query(api.users.me, {}))!._id;
    let rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows.every((row) => row.emailId === undefined)).toBe(true);

    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    expect(await t.mutation(internal.email.deliver, { notificationIds: rows.map((r) => r._id) })).toBe(2);
    rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    const anaRow = rows.find((row) => row.userId === anaId)!;

    // Resend reports the address bouncing (what the webhook handler does with the event).
    await t.run(async (ctx) => recordEmailStatus(ctx, anaRow.emailId!, "bounced"));
    expect((await ana.query(api.notifications.inbox, {})).emailBlocked).toBe(true);
    await quiz("Quiz 2");
    await settle(t);
    rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows.filter((row) => row.userId === anaId && row.emailId !== undefined)).toHaveLength(1);
  });
});

describe("agents retry safely", () => {
  test("the same requestId returns what the first call made", async () => {
    const { t, nino, courseId } = await seed();
    const ninoClerkId = "nino";
    const { serviceCredential } = await import("../lib/mcp/oauth");
    const token = await serviceCredential(ninoClerkId);
    const first = await t.mutation(api.mcp.createAssessmentAsAgent, {
      token,
      client: "claude.ai",
      requestId: "req-1",
      courseId,
      kind: "quiz",
      title: "Drafted",
    });
    const again = await t.mutation(api.mcp.createAssessmentAsAgent, {
      token: await serviceCredential(ninoClerkId),
      requestId: "req-1",
      courseId,
      kind: "quiz",
      title: "Drafted",
    });
    expect(again).toBe(first);
    expect((await nino.query(api.courses.get, { courseId })).assessments).toHaveLength(1);

    const ids = await t.mutation(api.mcp.addQuestionsAsAgent, {
      token: await serviceCredential(ninoClerkId),
      requestId: "req-2",
      assessmentId: first,
      questions: [{ type: "essay", prompt: "Why?" }],
    });
    const idsAgain = await t.mutation(api.mcp.addQuestionsAsAgent, {
      token: await serviceCredential(ninoClerkId),
      requestId: "req-2",
      assessmentId: first,
      questions: [{ type: "essay", prompt: "Why?" }],
    });
    expect(idsAgain).toEqual(ids);
    expect((await nino.query(api.assessments.get, { assessmentId: first })).questions).toHaveLength(1);
    // The audit log says which client the agent came through.
    const activity = await nino.query(api.audit.recentForMe, {});
    expect(activity.some((entry) => entry.via === "mcp")).toBe(true);
    const entry = await t.run(async (ctx) => ctx.db.query("auditLog").order("desc").take(5));
    expect(entry.some((row) => row.client === "claude.ai")).toBe(true);
    // Agents never see join codes.
    const courses = await t.query(api.mcp.listCourses, { token: await serviceCredential(ninoClerkId) });
    expect(JSON.stringify(courses)).not.toContain("joinCode");
  });
});
