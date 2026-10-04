/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { KALAMI_GUIDE } from "../lib/kalami/guide";
import { lessonBlockSchema } from "./lib/contentSchemas";
import { kalamiFileName, parseKalami } from "./lib/kalami";
import { expectAppError, person, seed } from "./test.setup";

const SECRET = "test-service-secret-0123456789abcdef";
beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function credential(clerkUserId: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

/** A small HTML/CSS task whose solution passes its checks. */
const codeTask = {
  type: "code" as const,
  prompt: "Build a heading.",
  points: 3,
  starterFiles: [{ name: "index.html", content: "<!DOCTYPE html>\n<html>\n<body>\n\n</body>\n</html>\n" }],
  steps: [
    {
      title: "Add a heading",
      instructions: "Add an `<h1>` inside `<body>`.",
      checks: [{ label: "There is an h1", type: "exists" as const, selector: "h1" }],
    },
  ],
  hiddenChecks: [{ label: "Only one h1", type: "count" as const, selector: "h1", max: 1 }],
  solution: [{ name: "index.html", content: "<!DOCTYPE html>\n<html>\n<body>\n<h1>Hi</h1>\n</body>\n</html>\n" }],
};

/** A course with every kind of content, for round trips. */
async function richCourse() {
  const s = await seed();
  const { nino, courseId } = s;
  const week = await nino.mutation(api.weeks.create, {
    courseId,
    title: "Week 1 · HTML",
    description: "Pages and headings.",
    links: [{ title: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/HTML" }],
  });
  await nino.mutation(api.lessons.create, {
    weekId: week,
    title: "What is HTML",
    blocks: [
      { type: "text", md: "HTML gives a page its **structure**." },
      { type: "code", language: "html", code: "<h1>Hello</h1>", preview: true },
      { type: "check", check: { kind: "single", prompt: "Which tag is a heading?", options: [{ text: "<h1>", correct: true }, { text: "<p>", correct: false }] } },
    ],
  });
  const quiz = await nino.mutation(api.assessments.create, { courseId, kind: "quiz", title: "Quiz 1", weekId: week });
  await nino.mutation(api.questions.add, {
    assessmentId: quiz,
    questions: [
      { type: "single", prompt: "Pick h1", points: 2, options: [{ text: "<p>", correct: false }, { text: "<h1>", correct: true }] },
      { type: "multiple", prompt: "Block elements?", options: [{ text: "div", correct: true }, { text: "span", correct: false }, { text: "p", correct: true }] },
      { type: "short", prompt: "CSS stands for?", acceptedAnswers: ["Cascading Style Sheets"], caseSensitive: false },
      { type: "essay", prompt: "Why semantics?", rubric: "Mentions accessibility." },
    ],
  });
  const task = await nino.mutation(api.assessments.create, { courseId, kind: "task", title: "Heading task" });
  await nino.mutation(api.questions.add, { assessmentId: task, questions: [codeTask] });
  const midterm = await nino.mutation(api.assessments.create, {
    courseId,
    kind: "midterm",
    title: "Midterm",
    settings: { timeLimitMin: 45, opensAt: Date.now() + 86_400_000 },
  });
  await nino.mutation(api.questions.add, {
    assessmentId: midterm,
    questions: [{ type: "short", prompt: "Tag for links?", acceptedAnswers: ["a", "<a>"] }],
  });
  return { ...s, week, quiz, task, midterm };
}

describe(".kalami files", () => {
  test("export → import gives back the same course, as a new draft, verified by Kalami", async () => {
    const { nino, courseId } = await richCourse();
    const { fileName, content } = await nino.query(api.kalami.exportCourse, { courseId });
    expect(fileName).toBe("web-basics.kalami");

    const parsed = parseKalami(content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { course } = parsed.file;
    expect(course.weeks).toHaveLength(1);
    expect(course.weeks[0].assessments.map((a) => a.title)).toEqual(["Quiz 1"]);
    expect(course.other.map((a) => a.title)).toEqual(["Heading task"]);
    expect(course.exams[0].settings).toMatchObject({ timeLimitMin: 45 });
    // Dates and ids never travel in files.
    expect(content).not.toMatch(/opensAt|closesAt|"_id"|"id":/);
    // Answer keys do, inside the questions.
    expect(course.weeks[0].assessments[0].questions[0]).toMatchObject({ options: [{ correct: false }, { correct: true }] });

    const inspected = await nino.action(api.kalami.inspect, { text: content });
    expect(inspected).toMatchObject({
      ok: true,
      summary: { weeks: 1, lessons: 1, questions: 6, assessments: { task: 1, quiz: 1, midterm: 1, final: 0 } },
      verified: { by: "nino" },
    });

    const imported = await nino.action(api.kalami.importCourse, { text: content });
    expect(imported).toMatchObject({ ok: true, verified: { by: "nino" } });
    if (!imported.ok) return;
    expect(imported.courseId).not.toBe(courseId);
    const copy = await nino.query(api.courses.get, { courseId: imported.courseId });
    expect(copy).toMatchObject({ title: "Web basics", status: "draft" });

    // Exporting the copy gives the same course content.
    const again = parseKalami((await nino.query(api.kalami.exportCourse, { courseId: imported.courseId })).content);
    expect(again.ok && again.file.course).toEqual(course);
  });

  test("an edited file still imports, but isn't marked verified", async () => {
    const { nino, courseId } = await richCourse();
    const { content } = await nino.query(api.kalami.exportCourse, { courseId });
    const edited = content.replace('"Quiz 1"', '"Quiz one"');
    expect(await nino.action(api.kalami.inspect, { text: edited })).toMatchObject({ ok: true, verified: null });
  });

  test("a file written by hand or by an AI (no signature) imports as a draft course", async () => {
    const { nino } = await seed();
    const file = {
      format: "kalami",
      version: 1,
      kind: "course",
      exported: { by: "Claude", at: "2026-10-04T20:00:00Z", from: "Claude" },
      course: {
        title: "Intro to CSS",
        language: "en",
        weeks: [
          {
            title: "Week 1 · Selectors",
            lessons: [
              {
                title: "Choosing elements",
                blocks: [
                  { type: "text", md: "A **selector** chooses which elements a rule styles." },
                  { type: "callout", tone: "definition", title: "Selector", md: "The part before `{`." },
                  {
                    type: "steps",
                    steps: [{ md: "Write the selector." }, { md: "Open `{`, add declarations, close `}`." }],
                  },
                ],
              },
            ],
            assessments: [
              {
                kind: "quiz",
                title: "Selectors quiz",
                questions: [{ type: "short", prompt: "Selector for every paragraph?", acceptedAnswers: ["p"] }],
              },
            ],
          },
        ],
      },
    };
    const result = await nino.action(api.kalami.importCourse, { text: JSON.stringify(file) });
    expect(result).toMatchObject({ ok: true, verified: null, summary: { weeks: 1, lessons: 1, questions: 1 } });
    if (!result.ok) return;
    const outline = await nino.query(api.weeks.outline, { courseId: result.courseId, now: Date.now() });
    expect(outline.weeks[0]).toMatchObject({
      title: "Week 1 · Selectors",
      status: "draft",
      lessons: [expect.objectContaining({ title: "Choosing elements", blockCount: 3 })],
      assessments: [expect.objectContaining({ title: "Selectors quiz", questionCount: 1, status: "draft" })],
    });
  });

  test("broken files explain themselves and create nothing", async () => {
    const { nino } = await seed();
    const before = (await nino.query(api.courses.listMine, {})).length;
    const bad = async (text: string) => {
      const result = await nino.action(api.kalami.importCourse, { text });
      expect(result.ok).toBe(false);
      return result.ok ? [] : result.errors;
    };
    expect((await bad("not json"))[0]).toMatch(/doesn't parse/);
    expect((await bad(JSON.stringify({ format: "kalami", version: 2, kind: "course" })))[0]).toMatch(/version 2/);
    const twoCorrect = {
      format: "kalami",
      version: 1,
      kind: "course",
      course: {
        title: "T",
        language: "en",
        exams: [
          {
            kind: "final",
            title: "Final",
            questions: [{ type: "single", prompt: "Q", options: [{ text: "a", correct: true }, { text: "b", correct: true }] }],
          },
        ],
        weeks: [{ title: "W", lessons: [{ title: "L", blocks: [{ type: "image", url: "https://example.com/a.png", alt: "" }] }] }],
      },
    };
    const errors = await bad(JSON.stringify(twoCorrect));
    expect(errors.join("\n")).toMatch(/course › weeks\[0\] › lessons\[0\] › blocks\[0\] › alt/);
    const deeper = { ...twoCorrect, course: { ...twoCorrect.course, weeks: [] } };
    expect((await bad(JSON.stringify(deeper))).join("\n")).toMatch(/course › exams\[0\] › questions\[0\]: .*one/i);
    expect((await nino.query(api.courses.listMine, {})).length).toBe(before);
  });

  test("only course editors export; students can't open files", async () => {
    const { t, nino, ana, courseId, universityId } = await seed();
    const other = t.withIdentity(person("levan"));
    const levanId = await other.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { userId: levanId, role: "lecturer", universityId });
      await ctx.db.insert("courseStaff", { courseId, userId: levanId, role: "assistant" });
    });
    await expectAppError(other.query(api.kalami.exportCourse, { courseId }), "FORBIDDEN");
    await expectAppError(ana.action(api.kalami.inspect, { text: "{}" }), "FORBIDDEN");
    void nino;
  });

  test("an agent can check a file, fix it, and import it", async () => {
    const { nino } = await seed();
    const token = await credential("nino");
    const draft = {
      format: "kalami",
      version: 1,
      kind: "course",
      course: { title: "Agent course", language: "ka", weeks: [{ title: "კვირა 1", links: [{ title: "x", url: "http://insecure.example.com" }] }] },
    };
    const first = await nino.action(api.mcp.checkKalamiForAgent, { token, text: JSON.stringify(draft) });
    expect(first.ok).toBe(false);
    draft.course.weeks[0].links[0].url = "https://secure.example.com";
    const result = await nino.action(api.mcp.importKalamiForAgent, { token, text: JSON.stringify(draft) });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const exported = await nino.query(api.mcp.exportCourseForAgent, { token, courseId: result.courseId as Id<"courses"> });
    expect(exported.fileName).toBe("agent-course.kalami");
  });

  test("an agent retrying an import with the same requestId gets the same course", async () => {
    const { nino } = await seed();
    const token = await credential("nino");
    const text = JSON.stringify({ format: "kalami", version: 1, kind: "course", course: { title: "Retry course", language: "en" } });
    const before = (await nino.query(api.courses.listMine, {})).length;
    const first = await nino.action(api.mcp.importKalamiForAgent, { token, requestId: "import-1", text });
    const again = await nino.action(api.mcp.importKalamiForAgent, { token, requestId: "import-1", text });
    expect(first.ok && again.ok && again.courseId === first.courseId).toBe(true);
    expect((await nino.query(api.courses.listMine, {})).length).toBe(before + 1);
  });

  test("file names keep Georgian letters", () => {
    expect(kalamiFileName("ვებ ტექნოლოგიები 2026")).toBe("ვებ-ტექნოლოგიები-2026.kalami");
    expect(kalamiFileName("  !!! ")).toBe("course.kalami");
  });

  test("the guide's own examples are valid: its complete file imports, its blocks parse", async () => {
    const { nino } = await seed();
    const fenced = (after: string) => {
      const start = KALAMI_GUIDE.indexOf("~~~json", KALAMI_GUIDE.indexOf(after)) + "~~~json".length;
      return KALAMI_GUIDE.slice(start, KALAMI_GUIDE.indexOf("~~~", start));
    };
    const result = await nino.action(api.kalami.importCourse, { text: fenced("## A complete small file") });
    expect(result).toMatchObject({ ok: true, summary: { weeks: 1, lessons: 1, questions: 2 } });
    const blocks = JSON.parse(fenced("## Lessons: blocks")) as unknown[];
    for (const block of blocks) expect(lessonBlockSchema.safeParse(block).success).toBe(true);
    expect(JSON.parse(fenced("## The shape"))).toMatchObject({ format: "kalami", version: 1 });
  });
});
