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
  return `${typeof origin === "string" ? origin : "https://anticheat.kalami.space"}${path}`;
}

const INSTRUCTIONS = `You are connected to Kalami, a university learning and exam platform, as a lecturer's assistant.

Workflow:
1. Call whoami to learn who you act for and which universities they belong to.
2. list_courses, or create_course if the course doesn't exist yet.
3. create_assessment (kind: quiz, midterm or final) inside a course. It starts as a draft.
4. add_questions in batches of up to 50. Mark correct options with "correct": true.
5. get_assessment to review what you built; update_question / delete_question / reorder_questions to fix it.
6. When you are done, give the lecturer the reviewUrl from your results so they can check and publish.

Rules:
- You can only change DRAFT assessments. Only the lecturer can publish, in the Kalami dashboard. If an assessment is already published, ask the lecturer to move it back to draft before you edit it.
- You cannot see students, attempts or grades. Never ask for student data.
- Write questions in the course's language (ka = Georgian, en = English) unless told otherwise.
- Quizzes default to standard integrity; midterms and finals default to strict integrity with a time limit.`;

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
        description: "A course with all of its quizzes, midterms and finals (settings and status, not questions).",
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
          "Creates a draft quiz, midterm or final in a course and returns its id and a reviewUrl for the lecturer. Then add_questions.",
        inputSchema: z.object({
          courseId,
          kind: z.enum(["quiz", "midterm", "final"]),
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
          kind: z.enum(["quiz", "midterm", "final"]).optional(),
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
          "Appends up to 50 questions to a draft assessment. Types: single (one correct option), multiple (one or more correct), short (accepted answers), essay (rubric). Returns the new question ids.",
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
    serverInfo: { name: "kalami", version: "0.2.0" },
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
