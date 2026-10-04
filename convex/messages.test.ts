/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { renderStaffMessageEmail, renderStudentReplyEmail } from "./lib/email/templates";
import { RETENTION_MS } from "./model/messages";
import { expectAppError, person, seed } from "./test.setup";

beforeEach(() => {
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const op = (n: number) => `op-${String(n).padStart(8, "0")}`;

describe("contact card", () => {
  test("a student writes to their lecturer about a course; only the two of them can read it", async () => {
    const { t, nino, ana, giorgi, admin, courseId, universityId } = await seed();
    const options = await ana.query(api.messages.contactOptionsFor, { courseId });
    expect(options.lecturers.map((l) => l.name)).toEqual(["nino"]);
    expect(options.context.course?.title).toBe("Web basics");
    expect(options.adminAvailable).toBe(true);

    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "lecturer",
      lecturerId: options.lecturers[0].userId,
      courseId,
      topic: "assignment",
      subject: "Web basics · Week 3 task",
      body: "Hello nino,\nIs the task due Friday or Monday?",
    });

    // A double tap or a retry with the same id is the same conversation.
    const again = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "lecturer",
      lecturerId: options.lecturers[0].userId,
      courseId,
      topic: "assignment",
      subject: "Web basics · Week 3 task",
      body: "Hello nino,\nIs the task due Friday or Monday?",
    });
    expect(again).toBe(conversationId);
    expect(await ana.query(api.messages.mine, {})).toHaveLength(1);

    const inbox = await nino.query(api.messages.inbox, {});
    expect(inbox).toEqual([expect.objectContaining({ subject: "Web basics · Week 3 task", unread: true, studentName: "ana S", as: "lecturer" })]);
    expect(await nino.query(api.messages.unreadCount, {})).toBe(1);

    // Another student, the super admin and another lecturer can't read it.
    await expectAppError(giorgi.query(api.messages.thread, { conversationId }), "NOT_FOUND");
    await expectAppError(admin.query(api.messages.thread, { conversationId }), "NOT_FOUND");
    const other = t.withIdentity(person("levan"));
    const levanId = await other.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: levanId, role: "uni_admin", universityId });
    });
    await expectAppError(other.query(api.messages.thread, { conversationId }), "NOT_FOUND");
    expect(await admin.query(api.messages.inbox, {})).toEqual([]);

    // The lecturer reads and replies; the student sees it as unread until they open it.
    const thread = await nino.query(api.messages.thread, { conversationId });
    expect(thread).toMatchObject({ viewer: "lecturer", studentEmail: "ana@example.com", status: "open" });
    await nino.mutation(api.messages.markRead, { conversationId });
    expect(await nino.query(api.messages.unreadCount, {})).toBe(0);
    await nino.mutation(api.messages.reply, { conversationId, clientOpId: op(2), body: "Monday." });
    expect((await ana.query(api.messages.mine, {}))[0]).toMatchObject({ status: "answered", unread: true });
    expect(await ana.query(api.messages.unreadCount, {})).toBe(1);
    const studentView = await ana.query(api.messages.thread, { conversationId });
    expect(studentView.messages.map((m) => [m.from, m.body, m.mine])).toEqual([
      ["student", "Hello nino,\nIs the task due Friday or Monday?", true],
      ["staff", "Monday.", false],
    ]);
    expect(studentView.studentEmail).toBeUndefined();
    await ana.mutation(api.messages.markRead, { conversationId });
    expect(await ana.query(api.messages.unreadCount, {})).toBe(0);

    // Either side resolves; a new message reopens.
    await ana.mutation(api.messages.resolve, { conversationId, resolved: true });
    expect((await nino.query(api.messages.inbox, {}))[0].status).toBe("resolved");
    await ana.mutation(api.messages.reply, { conversationId, clientOpId: op(3), body: "One more thing…" });
    expect((await nino.query(api.messages.inbox, {}))[0].status).toBe("open");
  });

  test("recipients come from the server: a lecturer the student doesn't have is refused", async () => {
    const { t, ana, maka, courseId, universityId } = await seed();
    const stranger = t.withIdentity(person("levan"));
    const levanId = await stranger.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: levanId, role: "lecturer", universityId });
    });
    await expectAppError(
      ana.mutation(api.messages.start, {
        clientOpId: op(1),
        recipient: "lecturer",
        lecturerId: levanId,
        topic: "other",
        customTopic: "Hello",
        subject: "Hi",
        body: "Hi",
      }),
      "FORBIDDEN",
    );
    // maka isn't in the course: the course context is dropped, and she has no lecturers to pick.
    const options = await maka.query(api.messages.contactOptionsFor, { courseId });
    expect(options.context.course).toBeUndefined();
    expect(options.lecturers).toEqual([]);
  });

  test("the Kalami team gets technical messages; any super admin answers as the team", async () => {
    const { admin, ana, nino } = await seed();
    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "admin",
      topic: "app_problem",
      subject: "The quiz page froze",
      body: "It froze after question 3.",
    });
    expect(await nino.query(api.messages.inbox, {})).toEqual([]);
    const inbox = await admin.query(api.messages.inbox, {});
    expect(inbox).toEqual([expect.objectContaining({ as: "admin", topic: "app_problem" })]);
    await admin.mutation(api.messages.reply, { conversationId, clientOpId: op(2), body: "Fixed, thanks!" });
    const view = await ana.query(api.messages.thread, { conversationId });
    expect(view.recipientName).toBe("Kalami team");
    expect(view.messages[1].senderName).toBe("Kalami team");
  });

  test("context is checked: an unpublished week or someone else's course isn't attached", async () => {
    const { nino, ana, courseId } = await seed();
    const draftWeek = await nino.mutation(api.materials.addLink, { courseId, title: "Week 9", url: "https://example.com/9" });
    const options = await ana.query(api.messages.contactOptionsFor, { courseId, materialId: draftWeek });
    expect(options.context.material).toBeUndefined();
    await nino.mutation(api.materials.publish, { materialId: draftWeek });
    const published = await ana.query(api.messages.contactOptionsFor, { courseId, materialId: draftWeek });
    expect(published.context.material).toMatchObject({ title: "Week 9", url: "https://example.com/9" });
  });

  test("emails: the lecturer gets the message, the student a short notice, a burst emails once", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { t, nino, ana, courseId } = await seed();
    const { lecturers } = await ana.query(api.messages.contactOptionsFor, { courseId });
    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "lecturer",
      lecturerId: lecturers[0].userId,
      courseId,
      topic: "grade",
      subject: "Quiz 2 grade",
      body: "Could you explain question 4?",
    });
    await ana.mutation(api.messages.reply, { conversationId, clientOpId: op(2), body: "Sorry, question 5." });
    await nino.mutation(api.messages.reply, { conversationId, clientOpId: op(3), body: "Sure: …" });
    const messages = await t.run(async (ctx) =>
      await ctx.db
        .query("conversationMessages")
        .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
        .collect(),
    );
    expect(messages.map((m) => [m.from, m.emailIds?.length ?? 0, m.emailSkipped !== undefined])).toEqual([
      ["student", 1, false],
      ["student", 0, true],
      ["staff", 1, false],
    ]);
    expect((await ana.query(api.messages.thread, { conversationId })).messages.map((m) => m.emailed)).toEqual([true, false, true]);
  });

  test("email texts: staff see the message and where to reply; students get no message body", () => {
    const staff = renderStaffMessageEmail({
      locale: "en",
      studentName: "Ana <b>",
      subject: "Week 3",
      context: "Web basics · Week 3",
      body: "Line one\nLine two",
      isReply: false,
      url: "https://staff.kalami.space/inbox/x",
    });
    expect(staff.text).toContain("Line two");
    expect(staff.text).toContain("Reply in Kalami: https://staff.kalami.space/inbox/x");
    expect(staff.html).not.toContain("<b>");
    const student = renderStudentReplyEmail({
      locale: "ka",
      staffName: "ნინო",
      subject: "Week 3",
      url: "https://app.kalami.space/messages/x",
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?u=1&t=2",
    });
    expect(student.subject).toBe("ნინო გიპასუხა: Week 3");
    expect(student.text).toContain("https://app.kalami.space/messages/x");
  });

  test("resolved conversations are deleted a year later; open ones stay", async () => {
    const { t, ana } = await seed();
    const old = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "admin",
      topic: "app_problem",
      subject: "Old",
      body: "Old problem",
    });
    await ana.mutation(api.messages.start, {
      clientOpId: op(2),
      recipient: "admin",
      topic: "app_problem",
      subject: "Still open",
      body: "Open problem",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("conversations", old, { status: "resolved", resolvedAt: Date.now() - RETENTION_MS - 1000 });
    });
    expect(await t.mutation(internal.messages.deleteExpired, {})).toBe(1);
    expect((await ana.query(api.messages.mine, {})).map((c) => c.subject)).toEqual(["Still open"]);
  });

  test("bad input is refused before anything is saved", async () => {
    const { ana } = await seed();
    await expectAppError(
      ana.mutation(api.messages.start, { clientOpId: "x", recipient: "admin", topic: "app_problem", subject: "S", body: "B" }),
      "INVALID_INPUT",
    );
    await expectAppError(
      ana.mutation(api.messages.start, { clientOpId: op(1), recipient: "admin", topic: "other", subject: "S", body: "B" }),
      "INVALID_INPUT",
    );
    await expectAppError(
      ana.mutation(api.messages.start, { clientOpId: op(2), recipient: "admin", topic: "app_problem", subject: "S", body: "   " }),
      "INVALID_INPUT",
    );
    expect(await ana.query(api.messages.mine, {})).toEqual([]);
  });
});

describe("contact card: hardening", () => {
  test("a lecturer without a name shows as “Lecturer” to students, never as their email", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { t, nino, ana, courseId } = await seed();
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      await ctx.db.patch("users", ninoId, { firstName: undefined, lastName: undefined });
    });
    const options = await ana.query(api.messages.contactOptionsFor, { courseId });
    expect(options.lecturers.map((l) => l.name)).toEqual(["Lecturer"]);
    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "lecturer",
      lecturerId: options.lecturers[0].userId,
      courseId,
      topic: "assignment",
      subject: "Q",
      body: "Question",
    });
    await nino.mutation(api.messages.reply, { conversationId, clientOpId: op(2), body: "Answer" });
    const view = await ana.query(api.messages.thread, { conversationId });
    expect(view.recipientName).toBe("Lecturer");
    expect(view.messages[1].senderName).toBe("Lecturer");
    expect(JSON.stringify(view)).not.toContain("nino@example.com");
    expect(JSON.stringify(await ana.query(api.messages.mine, {}))).not.toContain("nino@example.com");
  });

  test("a lecturer who lost their role gets no more emails, and the student is told", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { t, nino, ana, courseId } = await seed();
    const { lecturers } = await ana.query(api.messages.contactOptionsFor, { courseId });
    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "lecturer",
      lecturerId: lecturers[0].userId,
      courseId,
      topic: "assignment",
      subject: "Q",
      body: "Question",
    });
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query("memberships").withIndex("by_userId", (q) => q.eq("userId", ninoId)).collect()) {
        await ctx.db.delete("memberships", m._id);
      }
    });
    await expectAppError(ana.mutation(api.messages.reply, { conversationId, clientOpId: op(2), body: "Hello?" }), "CONFLICT");
  });

  test("a message id reused in another conversation is refused, not merged", async () => {
    const { ana } = await seed();
    const first = await ana.mutation(api.messages.start, { clientOpId: op(1), recipient: "admin", topic: "app_problem", subject: "A", body: "A" });
    const second = await ana.mutation(api.messages.start, { clientOpId: op(2), recipient: "admin", topic: "app_problem", subject: "B", body: "B" });
    await ana.mutation(api.messages.reply, { conversationId: first, clientOpId: op(3), body: "More A" });
    await expectAppError(ana.mutation(api.messages.reply, { conversationId: second, clientOpId: op(3), body: "More B" }), "CONFLICT");
    // The first message of a conversation can't be reused to "start" again elsewhere either.
    await expectAppError(
      ana.mutation(api.messages.start, { clientOpId: op(3), recipient: "admin", topic: "app_problem", subject: "C", body: "C" }),
      "CONFLICT",
    );
  });

  test("a retried send still returns the conversation when the rate limit is used up", async () => {
    const { ana } = await seed();
    const ids = [];
    for (let i = 1; i <= 4; i++) {
      ids.push(await ana.mutation(api.messages.start, { clientOpId: op(i), recipient: "admin", topic: "app_problem", subject: `S${i}`, body: "B" }));
    }
    await expectAppError(
      ana.mutation(api.messages.start, { clientOpId: op(9), recipient: "admin", topic: "app_problem", subject: "S9", body: "B" }),
      "RATE_LIMITED",
    );
    expect(
      await ana.mutation(api.messages.start, { clientOpId: op(4), recipient: "admin", topic: "app_problem", subject: "S4", body: "B" }),
    ).toBe(ids[3]);
  });

  test("Resend's test mode skips real addresses instead of failing the send", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_TEST_MODE", "true");
    const { ana } = await seed();
    const conversationId = await ana.mutation(api.messages.start, {
      clientOpId: op(1),
      recipient: "admin",
      topic: "app_problem",
      subject: "S",
      body: "B",
    });
    expect((await ana.query(api.messages.thread, { conversationId })).messages[0].emailed).toBe(false);
  });

  test("a bounced address isn't emailed again, even without an account", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { t, nino } = await seed();
    const groupId = await nino.mutation(api.groups.create, { name: "G" });
    const first = await nino.mutation(api.groups.invite, { groupId, emails: ["nobody@example.com"] });
    expect(first.emailed).toBe(1);
    const emailId = await t.run(async (ctx) => (await ctx.db.query("emailLog").first())!.emailId);
    await t.run(async (ctx) => {
      const { recordEmailStatus } = await import("./email");
      await recordEmailStatus(ctx, emailId, "bounced");
    });
    const group2 = await nino.mutation(api.groups.create, { name: "G2" });
    expect((await nino.mutation(api.groups.invite, { groupId: group2, emails: ["nobody@example.com"] })).emailed).toBe(0);
  });
});
