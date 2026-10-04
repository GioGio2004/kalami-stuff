/// <reference types="vite/client" />
import { createTest } from "./test.setup";
import type { UserIdentity } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HONESTY_NOTICE } from "./lib/honestyNotice";

const ISSUER = "https://test.clerk.accounts.dev";
const SECRET = "test-service-secret-0123456789abcdef";

beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * What the staff app's lib/mcp/oauth.ts serviceCredential() sends Convex after
 * a lecturer signs in with Kalami in their assistant.
 */
async function credential(clerkUserId: string, { expiresIn = 60_000, secret = SECRET } = {}) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + expiresIn })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

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

async function expectAppError(call: Promise<unknown>, code: string, message?: string) {
  try {
    await call;
  } catch (error) {
    const data = (error as { data?: { code?: string; message?: string } }).data;
    expect(data?.code).toBe(code);
    if (message !== undefined) {
      expect(data?.message).toBe(message);
    }
    return;
  }
  throw new Error(`Expected a ${code} error, but the call succeeded`);
}

const AGENT_DRAFT_ONLY =
  "This assessment is published. Agents can only edit drafts — ask the lecturer to move it back to draft in the Kalami dashboard first.";
const COURSE_ARCHIVED = "This course is archived. Restore it before editing.";

/**
 * A backend with a super admin, two universities, a lecturer and an admin in
 * the first one, a lecturer in the second, and a student.
 */
async function setup() {
  const t = createTest();
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const gori = await admin.mutation(api.universities.create, {
    nameKa: "გორი",
    nameEn: "Gori State",
    slug: "gori",
  });
  const tbilisi = await admin.mutation(api.universities.create, {
    nameKa: "თბილისი",
    nameEn: "Tbilisi State",
    slug: "tbilisi",
  });

  async function staff(name: string, role: "lecturer" | "uni_admin", universityId: Id<"universities">) {
    const identity = t.withIdentity(person(name));
    const userId = await identity.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId, role, universityId });
    });
    return identity;
  }

  const nino = await staff("nino", "lecturer", gori);
  const dean = await staff("dean", "uni_admin", gori);
  const luka = await staff("luka", "lecturer", gori);
  const other = await staff("other", "lecturer", tbilisi);

  const ana = t.withIdentity(person("ana"));
  await ana.mutation(api.users.store, {});
  await ana.mutation(api.users.completeStudentOnboarding, {
    firstName: "ანა",
    lastName: "ბერიძე",
    universityId: gori,
    faculty: "CS",
    group: "CS-1",
    year: 1,
    locale: "ka",
    honestyVersion: HONESTY_NOTICE.version,
  });

  return { t, admin, nino, dean, luka, other, ana, gori, tbilisi };
}

const single = {
  type: "single" as const,
  prompt: "Which tag makes a link?",
  points: 2,
  options: [
    { text: "<a>", correct: true },
    { text: "<link>", correct: false },
    { text: "<href>", correct: false },
  ],
};
const multiple = {
  type: "multiple" as const,
  prompt: "Which are block elements?",
  options: [
    { text: "<div>", correct: true },
    { text: "<span>", correct: false },
    { text: "<p>", correct: true },
  ],
};
const short = {
  type: "short" as const,
  prompt: "What does CSS stand for?",
  points: 1.5,
  acceptedAnswers: ["Cascading Style Sheets", " cascading style sheets "],
};

describe("courses", () => {
  test("a lecturer creates a course in their own university and owns it", async () => {
    const { nino, gori } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: " Web basics " });
    const mine = await nino.query(api.courses.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      _id: courseId,
      title: "Web basics",
      universityId: gori,
      role: "owner",
      canEdit: true,
      status: "draft",
      joinEnabled: true,
      createdVia: "web",
      counts: { quizzes: 0, midterms: 0, finals: 0, drafts: 0, published: 0 },
    });
    expect(mine[0].joinCode).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("students can't use the studio at all", async () => {
    const { t, ana } = await setup();
    await expectAppError(ana.query(api.courses.listMine, {}), "FORBIDDEN");
    await expectAppError(ana.mutation(api.courses.create, { title: "Nope" }), "FORBIDDEN");
    // Signing in with Kalami in an assistant doesn't help either.
    expect(await t.query(api.mcp.whoami, { token: await credential("ana") })).toBeNull();
  });

  test("who can see and edit a course", async () => {
    const { nino, dean, luka, other, admin } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });

    // Another lecturer, even in the same university, can't tell the course exists.
    await expectAppError(luka.query(api.courses.get, { courseId }), "NOT_FOUND");
    expect(await luka.query(api.courses.listMine, {})).toHaveLength(0);
    // A lecturer in another university neither.
    await expectAppError(other.mutation(api.courses.update, { courseId, title: "x" }), "NOT_FOUND");

    // The university's admin and the super admin can edit it.
    expect((await dean.query(api.courses.get, { courseId })).role).toBe("admin");
    await dean.mutation(api.courses.update, { courseId, semester: "Spring 2026" });
    expect((await admin.query(api.courses.get, { courseId })).role).toBe("super_admin");
    expect((await admin.query(api.courses.listMine, {}))[0].semester).toBe("Spring 2026");

    // An assistant can open the course but not change it.
    const lukaId = (await luka.query(api.users.me, {}))!._id;
    await admin.run(async (ctx) => {
      await ctx.db.insert("courseStaff", { courseId, userId: lukaId, role: "assistant" });
    });
    expect((await luka.query(api.courses.get, { courseId })).canEdit).toBe(false);
    await expectAppError(luka.mutation(api.courses.newJoinCode, { courseId }), "FORBIDDEN");
  });

  test("the super admin must say which university a course belongs to", async () => {
    const { admin, tbilisi } = await setup();
    await expectAppError(admin.mutation(api.courses.create, { title: "Where?" }), "INVALID_INPUT");
    const courseId = await admin.mutation(api.courses.create, { title: "Here", universityId: tbilisi });
    expect((await admin.query(api.courses.get, { courseId })).universityId).toBe(tbilisi);
    expect(await admin.query(api.courses.universitiesForNewCourse, {})).toHaveLength(2);
  });

  test("a lecturer can't create a course in a university they don't belong to", async () => {
    const { nino, tbilisi } = await setup();
    await expectAppError(
      nino.mutation(api.courses.create, { title: "Elsewhere", universityId: tbilisi }),
      "FORBIDDEN",
    );
  });
});

describe("assessments and questions", () => {
  test("a quiz gets questions with answer keys, counters and a publish gate", async () => {
    const { nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const assessmentId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "quiz",
      title: "HTML basics",
    });
    await expectAppError(
      nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" }),
      "CONFLICT",
    );

    const ids = await nino.mutation(api.questions.add, {
      assessmentId,
      questions: [single, multiple, short],
    });
    expect(ids).toHaveLength(3);

    const detail = await nino.query(api.assessments.get, { assessmentId });
    expect(detail.assessment).toMatchObject({
      kind: "quiz",
      status: "draft",
      questionCount: 3,
      totalPoints: 4.5,
      settings: { integrityLevel: "standard", attemptsAllowed: 1 },
    });
    expect(detail.questions.map((q) => q.order)).toEqual([0, 1, 2]);
    const [q1, q2, q3] = detail.questions;
    expect(q1.options).toHaveLength(3);
    expect(q1.key).toEqual({ type: "single", correctOptionId: q1.options![0].id });
    expect(q2.key).toEqual({
      type: "multiple",
      correctOptionIds: [q2.options![0].id, q2.options![2].id],
    });
    expect(q3.key).toEqual({
      type: "short",
      acceptedAnswers: ["Cascading Style Sheets", "cascading style sheets"],
      caseSensitive: false,
    });

    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    const course = await nino.query(api.courses.get, { courseId });
    expect(course.counts).toMatchObject({ quizzes: 1, published: 1, drafts: 0 });
    expect(course.assessments[0].publishedAt).toBeDefined();
  });

  test("exams default to strict integrity and a time limit", async () => {
    const { nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const finalId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "final",
      title: "Final exam",
      settings: { attemptsAllowed: 2 },
    });
    const { assessment } = await nino.query(api.assessments.get, { assessmentId: finalId });
    expect(assessment.settings).toMatchObject({
      integrityLevel: "strict",
      timeLimitMin: 90,
      attemptsAllowed: 2,
      resultsVisibility: "score",
    });
    await expectAppError(
      nino.mutation(api.assessments.update, { assessmentId: finalId, settings: { attemptsAllowed: 0 } }),
      "INVALID_INPUT",
    );
    await expectAppError(
      nino.mutation(api.assessments.update, {
        assessmentId: finalId,
        settings: { opensAt: 2000, closesAt: 1000 },
      }),
      "INVALID_INPUT",
    );
  });

  test("bad questions are refused and add nothing", async () => {
    const { nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const assessmentId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "quiz",
      title: "Quiz",
    });
    const twoCorrect = {
      ...single,
      options: single.options.map((o) => ({ ...o, correct: true })),
    };
    await expectAppError(
      nino.mutation(api.questions.add, { assessmentId, questions: [short, twoCorrect] }),
      "INVALID_INPUT",
    );
    await expectAppError(
      nino.mutation(api.questions.add, {
        assessmentId,
        questions: [{ ...multiple, options: multiple.options.map((o) => ({ ...o, correct: false })) }],
      }),
      "INVALID_INPUT",
    );
    await expectAppError(
      nino.mutation(api.questions.add, {
        assessmentId,
        questions: [{ ...short, acceptedAnswers: ["  "] }],
      }),
      "INVALID_INPUT",
    );
    const { assessment, questions } = await nino.query(api.assessments.get, { assessmentId });
    expect(questions).toHaveLength(0);
    expect(assessment.questionCount).toBe(0);
  });

  test("deleting and reordering keep orders dense", async () => {
    const { nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const assessmentId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "midterm",
      title: "Midterm",
    });
    const [a, b, c] = await nino.mutation(api.questions.add, {
      assessmentId,
      questions: [single, multiple, short],
    });
    await nino.mutation(api.questions.reorder, { assessmentId, questionIds: [c, a, b] });
    let detail = await nino.query(api.assessments.get, { assessmentId });
    expect(detail.questions.map((q) => q._id)).toEqual([c, a, b]);

    await expectAppError(
      nino.mutation(api.questions.reorder, { assessmentId, questionIds: [a, b] }),
      "INVALID_INPUT",
    );

    await nino.mutation(api.questions.remove, { questionId: a });
    detail = await nino.query(api.assessments.get, { assessmentId });
    expect(detail.questions.map((q) => [q._id, q.order])).toEqual([
      [c, 0],
      [b, 1],
    ]);
    expect(detail.assessment.totalPoints).toBe(2.5);

    await nino.mutation(api.questions.update, {
      questionId: b,
      question: { type: "essay", prompt: "Explain the box model", points: 4, rubric: "Mentions margin" },
    });
    detail = await nino.query(api.assessments.get, { assessmentId });
    expect(detail.questions[1]).toMatchObject({
      type: "essay",
      points: 4,
      key: { type: "essay", rubric: "Mentions margin" },
    });
    expect(detail.questions[1].options).toBeUndefined();
    expect(detail.assessment.totalPoints).toBe(5.5);
  });

  test("only drafts can be deleted; archived ones are read-only", async () => {
    const { nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const assessmentId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "quiz",
      title: "Quiz",
    });
    await nino.mutation(api.questions.add, { assessmentId, questions: [single] });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });
    await expectAppError(nino.mutation(api.assessments.remove, { assessmentId }), "CONFLICT");
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "archived" });
    await expectAppError(
      nino.mutation(api.questions.add, { assessmentId, questions: [short] }),
      "CONFLICT",
    );
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "draft" });
    await nino.mutation(api.assessments.remove, { assessmentId });
    expect((await nino.query(api.courses.get, { courseId })).assessments).toHaveLength(0);
  });

  test("an archived course is read-only until it is restored", async () => {
    const { t, nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const assessmentId = await nino.mutation(api.assessments.create, {
      courseId,
      kind: "quiz",
      title: "Quiz",
    });
    const [questionId] = await nino.mutation(api.questions.add, { assessmentId, questions: [single] });
    const token = await credential("nino");

    await nino.mutation(api.courses.update, { courseId, status: "archived" });
    await expectAppError(
      nino.mutation(api.assessments.update, { assessmentId, title: "Renamed" }),
      "CONFLICT",
      COURSE_ARCHIVED,
    );
    await expectAppError(
      nino.mutation(api.questions.add, { assessmentId, questions: [short] }),
      "CONFLICT",
      COURSE_ARCHIVED,
    );
    await expectAppError(
      nino.mutation(api.questions.update, { questionId, question: short }),
      "CONFLICT",
      COURSE_ARCHIVED,
    );
    await expectAppError(
      nino.mutation(api.assessments.create, { courseId, kind: "quiz", title: "Another" }),
      "CONFLICT",
      COURSE_ARCHIVED,
    );
    await expectAppError(
      t.mutation(api.mcp.addQuestionsAsAgent, { token, assessmentId, questions: [short] }),
      "CONFLICT",
      COURSE_ARCHIVED,
    );
    expect((await nino.query(api.assessments.get, { assessmentId })).canEdit).toBe(false);

    // Restoring the course is still allowed, and editing works again afterwards.
    await nino.mutation(api.courses.update, { courseId, status: "draft" });
    await nino.mutation(api.assessments.update, { assessmentId, title: "Renamed" });
    expect((await nino.query(api.assessments.get, { assessmentId })).canEdit).toBe(true);
  });
});

describe("MCP connector", () => {
  test("a signed-in lecturer's agent acts as them, is audited as the agent, and stops with the staff role", async () => {
    const { t, nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const token = await credential("nino");

    const me = await t.query(api.mcp.whoami, { token });
    expect(me).toMatchObject({ email: "nino@example.com", isSuperAdmin: false });
    expect(me!.universities).toHaveLength(1);
    expect(await t.query(api.mcp.listCourses, { token })).toHaveLength(1);

    const assessmentId = await t.mutation(api.mcp.createAssessmentAsAgent, {
      token,
      courseId,
      kind: "quiz",
      title: "Drafted by an agent",
    });
    await t.mutation(api.mcp.addQuestionsAsAgent, { token, assessmentId, questions: [single, short] });
    const detail = await t.query(api.mcp.getAssessment, { token, assessmentId });
    expect(detail.assessment).toMatchObject({ createdVia: "mcp", status: "draft", questionCount: 2 });
    expect(detail.questions.every((q) => q.createdVia === "mcp")).toBe(true);

    const activity = await nino.query(api.audit.recentForMe, {});
    expect(activity[0]).toMatchObject({ via: "mcp", action: "question.add", mine: true });

    // Losing the staff role cuts the agent off on its next call.
    await t.run(async (ctx) => {
      for (const membership of await ctx.db
        .query("memberships")
        .withIndex("by_userId", (q) => q.eq("userId", me!.userId))
        .take(10)) {
        await ctx.db.delete("memberships", membership._id);
      }
    });
    expect(await t.query(api.mcp.whoami, { token })).toBeNull();
    await expectAppError(
      t.mutation(api.mcp.addQuestionsAsAgent, { token, assessmentId, questions: [short] }),
      "UNAUTHENTICATED",
    );
  });

  test("an agent only reaches its own lecturer's courses", async () => {
    const { t, nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Nino's course" });
    await expectAppError(
      t.mutation(api.mcp.createAssessmentAsAgent, { token: await credential("luka"), courseId, kind: "quiz", title: "x" }),
      "NOT_FOUND",
    );
  });

  test("forged, expired, unknown and retired credentials get nothing", async () => {
    const { t } = await setup();
    expect(await t.query(api.mcp.whoami, { token: await credential("nino", { secret: "wrong" }) })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: await credential("nino", { expiresIn: -1 }) })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: await credential("nobody") })).toBeNull();
    // One person's signature on another person's payload.
    const [prefix, , signature] = (await credential("nino")).split(".");
    const otherPayload = (await credential("admin")).split(".")[1];
    expect(await t.query(api.mcp.whoami, { token: `${prefix}.${otherPayload}.${signature}` })).toBeNull();
    // The personal tokens Kalami used to hand out.
    expect(await t.query(api.mcp.whoami, { token: "klm_0123456789abcdef0123456789abcdef01234567" })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: "" })).toBeNull();
  });

  test("without the secret configured, no credential works", async () => {
    const { t } = await setup();
    const token = await credential("nino");
    vi.stubEnv("MCP_SERVICE_SECRET", "");
    expect(await t.query(api.mcp.whoami, { token })).toBeNull();
  });

  test("agents can only edit drafts; people can still edit published assessments", async () => {
    const { t, nino } = await setup();
    const courseId = await nino.mutation(api.courses.create, { title: "Web basics" });
    const token = await credential("nino");
    const assessmentId = await t.mutation(api.mcp.createAssessmentAsAgent, {
      token,
      courseId,
      kind: "quiz",
      title: "Quiz",
    });
    const [a, b] = await t.mutation(api.mcp.addQuestionsAsAgent, {
      token,
      assessmentId,
      questions: [single, short],
    });
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "published" });

    const refused = [
      () => t.mutation(api.mcp.updateAssessmentAsAgent, { token, assessmentId, title: "Changed" }),
      () => t.mutation(api.mcp.addQuestionsAsAgent, { token, assessmentId, questions: [short] }),
      () => t.mutation(api.mcp.updateQuestionAsAgent, { token, questionId: a, question: short }),
      () => t.mutation(api.mcp.deleteQuestionAsAgent, { token, questionId: a }),
      () => t.mutation(api.mcp.reorderQuestionsAsAgent, { token, assessmentId, questionIds: [b, a] }),
    ];
    for (const call of refused) {
      await expectAppError(call(), "FORBIDDEN", AGENT_DRAFT_ONLY);
    }
    const asAgent = await t.query(api.mcp.getAssessment, { token, assessmentId });
    expect(asAgent.canEdit).toBe(false);
    expect(asAgent.assessment).toMatchObject({ title: "Quiz", questionCount: 2 });

    // The lecturer in the dashboard is unaffected.
    expect((await nino.query(api.assessments.get, { assessmentId })).canEdit).toBe(true);
    await nino.mutation(api.assessments.update, { assessmentId, title: "Quiz 1" });

    // Back in draft, the agent can work on it again.
    await nino.mutation(api.assessments.setStatus, { assessmentId, status: "draft" });
    await t.mutation(api.mcp.updateAssessmentAsAgent, { token, assessmentId, title: "Quiz 1b" });
    expect((await t.query(api.mcp.getAssessment, { token, assessmentId })).canEdit).toBe(true);
  });

  test("deleting a user in Clerk removes their course staff seats and their agent's access", async () => {
    const { t, nino } = await setup();
    const userId = (await nino.query(api.users.me, {}))!._id;
    await nino.mutation(api.courses.create, { title: "Web basics" });
    const token = await credential("nino");
    expect(await t.query(api.mcp.whoami, { token })).not.toBeNull();

    // A repeat delivery falls back to the issuer-based lookup, which needs this.
    vi.stubEnv("CLERK_FRONTEND_API_URL", ISSUER);
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "nino" });
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "nino" });

    const leftovers = await t.run(async (ctx) => ({
      user: await ctx.db.get("users", userId),
      seats: await ctx.db
        .query("courseStaff")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .take(10),
    }));
    expect(leftovers.seats).toEqual([]);
    expect(leftovers.user?.deletedAt).toBeDefined();
    expect(await t.query(api.mcp.whoami, { token })).toBeNull();
  });

  test("the studio intro is marked seen once, for staff only", async () => {
    const { nino, ana } = await setup();
    expect((await nino.query(api.users.me, {}))!.studioIntroSeenAt).toBeUndefined();
    await nino.mutation(api.users.markStudioIntroSeen, {});
    const seenAt = (await nino.query(api.users.me, {}))!.studioIntroSeenAt;
    expect(seenAt).toBeDefined();
    await nino.mutation(api.users.markStudioIntroSeen, {});
    expect((await nino.query(api.users.me, {}))!.studioIntroSeenAt).toBe(seenAt);
    await expectAppError(ana.mutation(api.users.markStudioIntroSeen, {}), "FORBIDDEN");
  });
});
