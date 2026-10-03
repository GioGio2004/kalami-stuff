import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Kalami's MCP connector: lets a lecturer's own AI agent (Claude, ChatGPT,
 * Cursor, …) draft courses, quizzes and exams for them.
 *
 * Auth is a personal access token created on /agents in the staff app. Clients
 * that can send headers use `Authorization: Bearer klm_…` on /api/mcp; web
 * assistants that can't (claude.ai, ChatGPT) use the secret link
 * /api/mcp/k/klm_…. Either way the token is verified by Convex on every call,
 * so revoking it in the dashboard cuts the agent off immediately. Agents only
 * edit drafts; publishing stays a human click in the dashboard.
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
}
const convex = new ConvexHttpClient(convexUrl);

// --- Schemas shared by several tools -----------------------------------------

const courseId = z.string().describe("Course id from list_courses");
const assessmentId = z.string().describe("Assessment id from create_assessment or get_course");

const settingsSchema = z
  .object({
    opensAt: z.number().optional().describe("When students may start, as Unix milliseconds"),
    closesAt: z.number().optional().describe("Hard deadline, as Unix milliseconds"),
    timeLimitMin: z.number().int().min(1).max(600).optional().describe("Minutes per attempt"),
    attemptsAllowed: z.number().int().min(1).max(10).optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    integrityLevel: z
      .enum(["off", "standard", "strict"])
      .optional()
      .describe("off = practice; standard = tab tracking; strict = fullscreen exam"),
    resultsVisibility: z
      .enum(["hidden", "score", "full_after_close"])
      .optional()
      .describe("What students see afterwards"),
  })
  .describe("Only the fields you pass change; kind-based defaults fill the rest");

const prompt = z.string().min(1).max(4000).describe("The question text, Markdown allowed");
const points = z.number().min(0).max(100).optional().describe("Defaults to 1");
const explanation = z
  .string()
  .max(2000)
  .optional()
  .describe("Shown to students with full results after the assessment closes");
const choiceOptions = z
  .array(z.object({ text: z.string().min(1).max(500), correct: z.boolean() }))
  .min(2)
  .max(10);

// --- Code tasks (HTML/CSS sandbox) --------------------------------------------

const checkLabel = z
  .string()
  .min(1)
  .max(200)
  .describe('What the student reads next to the tick, e.g. "Your page has a <nav>"');
const selector = z.string().min(1).max(300).describe('A CSS selector, e.g. "nav ul li" or ".card h1"');
const every = z
  .boolean()
  .optional()
  .describe("true: every matching element must pass; false: one is enough");

const checkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exists"), label: checkLabel, selector }).describe("Something matches the selector"),
  z.object({ type: z.literal("not_exists"), label: checkLabel, selector }).describe("Nothing matches the selector"),
  z
    .object({
      type: z.literal("count"),
      label: checkLabel,
      selector,
      min: z.number().int().min(0).max(1000).optional(),
      max: z.number().int().min(0).max(1000).optional(),
    })
    .describe("How many elements match; give min, max or both (min = max for an exact count)"),
  z
    .object({
      type: z.literal("text"),
      label: checkLabel,
      selector,
      equals: z.string().optional(),
      contains: z.string().optional(),
      caseSensitive: z.boolean().optional().describe("Defaults to false"),
      every: every.describe("Defaults to false"),
    })
    .describe("The element's text (whitespace collapsed) equals or contains a string"),
  z
    .object({
      type: z.literal("attr"),
      label: checkLabel,
      selector,
      attribute: z.string().min(1).max(60),
      equals: z.string().optional(),
      contains: z.string().optional(),
      every: every.describe("Defaults to true"),
    })
    .describe("An attribute is present, or equals / contains a value"),
  z
    .object({
      type: z.literal("css"),
      label: checkLabel,
      selector,
      property: z.string().min(1).max(60).describe('e.g. "display", "background-color", "margin"'),
      equals: z.string().optional().describe('e.g. "flex", "#e63946", "0 auto"'),
      oneOf: z.array(z.string()).min(1).max(10).optional(),
      every: every.describe("Defaults to true"),
      viewport: z.number().int().min(200).max(3000).optional().describe("Screen width in px for @media rules; default 1280"),
    })
    .describe("The value the property ends up with after the cascade (specificity, inheritance, shorthands, browser defaults)"),
  z
    .object({ type: z.literal("linked"), label: checkLabel, href: z.string().min(1).max(200) })
    .describe('index.html has <link rel="stylesheet" href="…">'),
]);

const codeFile = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*\.(html|css)$/).describe('"index.html" or "style.css"'),
  content: z.string().max(50_000),
});

const codeQuestion = z.object({
  type: z.literal("code"),
  prompt: prompt.describe("What the student builds and why, shown above the steps. Markdown allowed"),
  points: z.number().min(0).max(100).optional().describe("Defaults to 1; the score is points × checks passed / all checks"),
  explanation,
  starterFiles: z
    .array(codeFile)
    .min(1)
    .max(5)
    .describe("What students start with. Must include index.html; include style.css (it may be empty) when the task uses CSS"),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        instructions: z.string().min(1).max(4000).describe("Markdown: what to add and why, with `inline code` for tags and properties"),
        hint: z.string().max(1000).optional().describe("Shown when the student asks for help"),
        checks: z.array(checkSchema).min(1).max(10).describe("Pass only once this step is done; ticked live as the student types"),
      }),
    )
    .min(1)
    .max(40),
  hiddenChecks: z
    .array(checkSchema)
    .max(30)
    .optional()
    .describe("Only run when the student submits, e.g. personal details or extra quality checks"),
  solution: z.array(codeFile).min(1).max(5).describe("The finished starter files. Every check must pass on it"),
  assets: z
    .array(
      z.object({
        name: z.string().describe('Short name students type, e.g. "cat.jpg"'),
        url: z.string().url().describe("The ImageKit URL of the image"),
        alt: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe("Images students may use. They can't upload their own"),
  variables: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/).describe('Used as {{name}}, e.g. "color"'),
        values: z.array(z.string().min(1).max(200)).min(1).max(20).describe("Each student gets one of these"),
      }),
    )
    .max(10)
    .optional()
    .describe(
      "Per-student variants so copying a friend's code fails. Use {{name}} in instructions, files, the solution and checks; {{student.firstName}} / {{student.lastName}} are the student's name",
    ),
});

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("single"),
    prompt,
    points,
    explanation,
    options: choiceOptions.describe("Exactly one option must be correct"),
  }),
  z.object({
    type: z.literal("multiple"),
    prompt,
    points,
    explanation,
    options: choiceOptions.describe("At least one option must be correct"),
  }),
  z.object({
    type: z.literal("short"),
    prompt,
    points,
    explanation,
    acceptedAnswers: z.array(z.string().min(1).max(200)).min(1).max(20),
    caseSensitive: z.boolean().optional().describe("Defaults to false"),
  }),
  z.object({
    type: z.literal("essay"),
    prompt,
    points,
    explanation,
    rubric: z.string().max(4000).optional().describe("Grading notes, only the lecturer sees them"),
  }),
  codeQuestion,
]);

// --- Helpers -----------------------------------------------------------------

function text(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function failure(error: unknown): CallToolResult {
  let message = "Something went wrong.";
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "object" && data !== null && "message" in data) {
      const { code, message: detail } = data as { code?: string; message?: string };
      message = `${code ?? "ERROR"}: ${detail ?? message}`;
    } else if (typeof data === "string") {
      message = data;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Runs a Convex call for a tool and turns its errors into tool errors. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await fn());
  } catch (error) {
    return failure(error);
  }
}

type ToolContext = { http?: { authInfo?: AuthInfo } };

function tokenOf(ctx: ToolContext): string {
  const token = ctx.http?.authInfo?.token;
  if (!token) {
    throw new Error("Missing access token");
  }
  return token;
}

/** The staff dashboard page where the lecturer reviews and publishes what the agent made. */
function dashboardUrl(ctx: ToolContext, path: string): string {
  const origin = ctx.http?.authInfo?.extra?.origin;
  return `${typeof origin === "string" ? origin : "https://staff.kalami.space"}${path}`;
}

const INSTRUCTIONS = `You are connected to Kalami, a university learning and exam platform, as a lecturer's assistant.

Workflow:
1. Call whoami to learn who you act for and which universities they belong to.
2. list_courses, or create_course if the course doesn't exist yet.
3. create_assessment (kind: task, quiz, midterm or final) inside a course. It starts as a draft.
4. add_questions in batches of up to 50. Mark correct options with "correct": true.
5. get_assessment to review what you built; update_question / delete_question / reorder_questions to fix it.
6. When you are done, give the lecturer the reviewUrl from your results so they can check and publish.

Rules:
- You can only change DRAFT assessments. Only the lecturer can publish, in the Kalami dashboard. If an assessment is already published, ask the lecturer to move it back to draft before you edit it.
- You cannot see students, attempts or grades. Never ask for student data.
- Write questions in the course's language (ka = Georgian, en = English) unless told otherwise.
- Tasks default to standard integrity with the score shown on submit; quizzes to standard integrity; midterms and finals to strict integrity with a time limit.

Code tasks (HTML and CSS only, written by hand in Kalami's sandbox; no JavaScript):
- Create an assessment with kind "task", then add one question of type "code".
- Teach in small steps, like freeCodeCamp. Each step asks for ONE new thing, explains what it is and why in 2–5 short sentences (Markdown, \`inline code\` for tags and properties), and has 1–3 checks that pass only once that thing is done.
- Students keep the same files from step to step, so later steps build on earlier ones. A step's checks must stay true after later steps, and each step should fail on the starter files.
- Write the solution: the finished files. Every check (steps and hidden) must pass on it.
- Call check_code_task first and fix every error it reports. add_questions refuses a code task whose solution fails a check.
- css checks compare the value the property ends up with after the cascade (specificity, inheritance, shorthands, browser defaults such as underlined links). Colours match in any notation (#f00 = red). Prefer longhands (margin-left, background-color) unless the step teaches the shorthand.
- Students start with the starter files and can't add new ones; include style.css (it may be empty) when the task uses CSS, and make linking it a step.
- Images: only from assets (ImageKit URLs). Students use the short name, e.g. <img src="cat.jpg">, and can't upload their own.
- Variants: add variables (e.g. color: ["#e63946", "#2a9d8f", "#3a86ff"]) and write {{color}} in the instructions, checks and solution, so each student gets their own values. {{student.firstName}} is the student's first name, e.g. a text check that the <h1> contains it. The solution must pass for every value; check_code_task tries each one.`;

// --- The server --------------------------------------------------------------

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description:
          "The lecturer this token belongs to, their roles, and the universities they can create courses in.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) =>
        run(async () => {
          const me = await convex.query(api.mcp.whoami, { token: tokenOf(ctx) });
          return me ?? "This token is invalid or was revoked.";
        }),
    );

    server.registerTool(
      "list_courses",
      {
        title: "List courses",
        description: "Every course the lecturer can work on, with join codes and assessment counts.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => convex.query(api.mcp.listCourses, { token: tokenOf(ctx) })),
    );

    server.registerTool(
      "get_course",
      {
        title: "Get course",
        description: "A course with all of its tasks, quizzes, midterms and finals (settings and status, not questions).",
        inputSchema: z.object({ courseId }),
      },
      async (args, ctx) =>
        run(() =>
          convex.query(api.mcp.getCourse, {
            token: tokenOf(ctx),
            courseId: args.courseId as Id<"courses">,
          }),
        ),
    );

    server.registerTool(
      "create_course",
      {
        title: "Create course",
        description:
          "Creates a draft course owned by the lecturer and returns its id. Pass universityId only when whoami lists more than one university.",
        inputSchema: z.object({
          title: z.string().min(1).max(120),
          description: z.string().max(2000).optional(),
          semester: z.string().max(60).optional().describe('e.g. "Spring 2026"'),
          locale: z.enum(["ka", "en"]).optional().describe("Language of the course"),
          universityId: z.string().optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createCourseAsAgent, {
            token: tokenOf(ctx),
            title: args.title,
            description: args.description,
            semester: args.semester,
            locale: args.locale,
            universityId: args.universityId as Id<"universities"> | undefined,
          });
          return { courseId: id, reviewUrl: dashboardUrl(ctx, `/courses/${id}`) };
        }),
    );

    server.registerTool(
      "create_assessment",
      {
        title: "Create assessment",
        description:
          "Creates a draft task (code sandbox homework), quiz, midterm or final in a course and returns its id and a reviewUrl for the lecturer. Then add_questions.",
        inputSchema: z.object({
          courseId,
          kind: z.enum(["task", "quiz", "midterm", "final"]),
          title: z.string().min(1).max(160),
          instructions: z.string().max(8000).optional().describe("Shown on the start screen"),
          settings: settingsSchema.optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createAssessmentAsAgent, {
            token: tokenOf(ctx),
            courseId: args.courseId as Id<"courses">,
            kind: args.kind,
            title: args.title,
            instructions: args.instructions,
            settings: args.settings,
          });
          return {
            assessmentId: id,
            status: "draft",
            reviewUrl: dashboardUrl(ctx, `/courses/${args.courseId}/assessments/${id}`),
          };
        }),
    );

    server.registerTool(
      "get_assessment",
      {
        title: "Get assessment",
        description: "An assessment's settings and every question with its answer key, in order.",
        inputSchema: z.object({ assessmentId }),
      },
      async (args, ctx) =>
        run(() =>
          convex.query(api.mcp.getAssessment, {
            token: tokenOf(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
          }),
        ),
    );

    server.registerTool(
      "update_assessment",
      {
        title: "Update assessment",
        description: "Changes the title, instructions, kind or settings of a draft assessment.",
        inputSchema: z.object({
          assessmentId,
          title: z.string().min(1).max(160).optional(),
          instructions: z.string().max(8000).optional(),
          kind: z.enum(["task", "quiz", "midterm", "final"]).optional(),
          settings: settingsSchema.optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateAssessmentAsAgent, {
            token: tokenOf(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
            title: args.title,
            instructions: args.instructions,
            kind: args.kind,
            settings: args.settings,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "add_questions",
      {
        title: "Add questions",
        description:
          "Appends up to 50 questions to a draft assessment. Types: single (one correct option), multiple (one or more correct), short (accepted answers), essay (rubric), code (an HTML/CSS task in steps; run check_code_task first). Returns the new question ids.",
        inputSchema: z.object({
          assessmentId,
          questions: z.array(questionSchema).min(1).max(50),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const ids = await convex.mutation(api.mcp.addQuestionsAsAgent, {
            token: tokenOf(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
            questions: args.questions,
          });
          return { questionIds: ids, added: ids.length };
        }),
    );

    server.registerTool(
      "check_code_task",
      {
        title: "Check code task",
        description:
          "Dry run for a code question: runs every check on the starter files and on the solution, saves nothing. Returns errors (checks the solution fails: fix before add_questions), warnings (steps already done in the starter) and a per-step table.",
        inputSchema: z.object({ question: codeQuestion }),
      },
      async (args, ctx) =>
        run(() => convex.query(api.mcp.checkCodeTask, { token: tokenOf(ctx), question: args.question })),
    );

    server.registerTool(
      "update_question",
      {
        title: "Update question",
        description: "Replaces a question completely (type, prompt, points, options and answer key).",
        inputSchema: z.object({
          questionId: z.string().describe("Question id from get_assessment"),
          question: questionSchema,
        }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateQuestionAsAgent, {
            token: tokenOf(ctx),
            questionId: args.questionId as Id<"questions">,
            question: args.question,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "delete_question",
      {
        title: "Delete question",
        description: "Removes a question from a draft; the others close the gap.",
        inputSchema: z.object({ questionId: z.string() }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deleteQuestionAsAgent, {
            token: tokenOf(ctx),
            questionId: args.questionId as Id<"questions">,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "reorder_questions",
      {
        title: "Reorder questions",
        description: "Sets the order of all questions. Pass every question id of the assessment exactly once.",
        inputSchema: z.object({ assessmentId, questionIds: z.array(z.string()).min(1) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderQuestionsAsAgent, {
            token: tokenOf(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
            questionIds: args.questionIds as Id<"questions">[],
          });
          return { ok: true };
        }),
    );
  },
  {
    serverInfo: { name: "kalami", version: "0.3.0" },
    instructions: INSTRUCTIONS,
  },
);

/** The origin people see (Vercel sits behind a proxy), for links back to the dashboard. */
function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** Checks a personal token against Convex. Undefined for a missing, invalid or revoked one. */
export async function verifyToken(req: Request, token: string | undefined): Promise<AuthInfo | undefined> {
  if (!token) {
    return undefined;
  }
  const me = await convex.query(api.mcp.whoami, { token });
  if (me === null) {
    return undefined;
  }
  return {
    token,
    clientId: me.userId,
    scopes: ["studio"],
    extra: { email: me.email, origin: publicOrigin(req) },
  };
}

/** Serves an MCP request for a token that was already verified (the secret-link route). */
export function handleVerified(req: Request, authInfo: AuthInfo): Promise<Response> {
  // mcp-handler reads the caller from `req.auth`, the same field withMcpAuth sets.
  (req as Request & { auth?: AuthInfo }).auth = authInfo;
  return handler(req);
}

/** /api/mcp: bearer tokens are checked against Convex; anything else is a 401. */
export const headerAuthHandler = withMcpAuth(handler, verifyToken, { required: true });
