import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { publicOrigin, serviceCredential, verifyOAuthToken } from "./oauth";
import {
  codeQuestion,
  deckThemeSchema,
  lessonBlockSchema,
  slidesSchema,
  linkSchema,
  questionSchema,
  settingsSchema,
} from "@/convex/lib/contentSchemas";
import type { Id } from "@/convex/_generated/dataModel";
import { anyKalamiFileSchema, KALAMI_GUIDE_URL, KALAMI_SCHEMA_URL } from "@/convex/lib/kalami";
import { KALAMI_GUIDE } from "@/lib/kalami/guide";
import { presentationShareUrl } from "@/lib/urls";

/**
 * Kalami's MCP connector: lets a lecturer's own AI agent (Claude, ChatGPT,
 * Cursor, …) draft courses, quizzes and exams for them.
 *
 * Auth on /api/mcp is "Sign in with Kalami": OAuth through Clerk (see
 * oauth.ts), so each lecturer signs in with their own account in their
 * assistant and there are no keys to hand around. Convex checks the person is
 * staff on every call, so losing the role cuts the agent off immediately.
 * Agents only edit drafts; publishing stays a human click in the dashboard.
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
}
const convex = new ConvexHttpClient(convexUrl);

// --- Schemas shared by several tools -----------------------------------------

const courseId = z.string().describe("Course id from list_courses");
const assessmentId = z.string().describe("Assessment id from create_assessment or get_course");


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

/** The OAuth client the agent connected through (claude.ai, ChatGPT, …), recorded in the audit log. */
function clientOf(ctx: ToolContext): string | undefined {
  const client = ctx.http?.authInfo?.extra?.client;
  return typeof client === "string" ? client.slice(0, 200) : undefined;
}

/** Both of the above, the way every backend call wants them. */
function auth(ctx: ToolContext) {
  return { token: tokenOf(ctx), client: clientOf(ctx) };
}

const requestId = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe("Your own unique id for this call. If the call times out, retry with the same requestId: you get the same result back instead of a duplicate");

/** The staff dashboard page where the lecturer reviews and publishes what the agent made. */
function dashboardUrl(ctx: ToolContext, path: string): string {
  const origin = ctx.http?.authInfo?.extra?.origin;
  return `${typeof origin === "string" ? origin : "https://staff.kalami.space"}${path}`;
}

// --- Course outline ------------------------------------------------------------

const weekId = z.string().describe("Week id from create_week or get_course_outline");
const lessonId = z.string().describe("Lesson id from create_lesson or get_course_outline");
const presentationId = z.string().describe("A presentation id, from create_presentation or get_course_outline");

const INSTRUCTIONS = `You are connected to Kalami, a learning and exam platform for universities, schools and private tutors, as a lecturer's assistant.

How a course is built: a course is a list of weeks (any title works: "Week 3", "Unit 2 · Forms"). Each week holds lessons written in Kalami, materials (links, plus a Google Drive folder the lecturer adds), and that week's tasks and quizzes. Midterms and finals sit in the course's Exams section, not in a week.

Workflow:
1. Call whoami to learn who you act for and which universities they belong to.
2. list_courses and put the work in the course the lecturer means. Students only see courses they joined (each shows how many have), so never start a new course on your own: if it's unclear which course, ask. Use create_course only when the lecturer asks for a new course.
3. get_course_outline to see what the course already has (weeks with their lessons, links, tasks and quizzes; the Exams section; work not placed in a week yet) before adding to it.
4. create_assessment (kind: task, quiz, midterm or final) inside a course, with weekId for a week's task or quiz. It starts as a draft. place_assessment moves a task or quiz to another week later.
5. add_questions in batches of up to 50. Mark correct options with "correct": true.
6. get_assessment to review what you built; update_question / delete_question / reorder_questions to fix it.
7. When you are done, give the lecturer the reviewUrl from your results so they can check and publish.

Turning a syllabus, notes or slides into a course:
1. create_week for each week or unit, with a one-sentence description and links to readings or videos.
2. create_lesson for each topic of the week, then add_lesson_blocks as needed. Keep lessons focused: one topic, roughly 5 to 25 blocks, so a student finishes one in 10 to 20 minutes.
3. create_assessment with weekId for the week's quiz or task, then add_questions.
4. Midterms and finals: create_assessment with kind midterm or final and no weekId; they appear in the Exams section.
5. Tell the lecturer what you drafted, week by week, with the reviewUrls. They publish each week themselves.

Tidying up an outline: update_week (title, description), reorder_weeks, reorder_lessons, move_lesson (to another week), reorder_presentations, move_presentation (to another week), update_week_link, reorder_week_links, remove_week_link, place_assessment, delete_week / delete_lesson / delete_presentation / delete_assessment (drafts only), update_course (a draft course's title, description, semester or language).

.kalami course files (a whole course in one JSON file):
- To give the lecturer their course as a file (to keep, share with a colleague, reuse next semester): export_course_file, then hand them the content as a file named fileName. It contains every answer key: only share it with staff.
- To build a whole course in one go: call get_kalami_format first and follow it exactly, write the file, check_kalami_file and fix every problem it lists, then import_kalami_file. It always creates a NEW draft course, so only do this when the lecturer wants a new course; to add to an existing course use create_week / create_lesson / create_assessment instead.
- A .kalami file can also hold one presentation (kind "presentation"): export_presentation_file gives one as a file, to move it to another course or another Kalami; import_presentation_file puts a presentation file into a week as a new draft.
- Never invent a "signature" field: only Kalami signs files.

Writing lessons (in the course's language):
- Short paragraphs; one idea per text block. Explain why before how.
- callout "definition" for each key term (title = the term), "tip" for practical advice, "warning" for a common mistake.
- code blocks for every example; for HTML and CSS set preview: true so students see the result.
- steps for procedures students follow in order.
- Presentations are their own item in a week, next to its lessons: use create_presentation (typed slides in a theme) whenever the lecturer asks for slides, a deck or a presentation, and ask which week it goes in if that isn't clear. Never build a presentation out of lesson blocks.
- A presentation can have a public link that anyone can watch it with, no account needed. Only the lecturer turns it on or off, with Share in the presentation's editor (drafts can be shared too). While it's on, get_presentation returns it as shareLink: give that url when the lecturer asks for the link.
- A scene block (type "scene") is for one custom animation inside a lesson (a diagram that builds up step by step); get_kalami_format has its vocabulary.
- A check every few blocks (single, multiple or short) so students test themselves; add an explanation.
- Images only from https URLs you are sure of, always with alt text. YouTube or Vimeo links play inside the lesson.
- Never invent facts about the lecturer's own course (dates, grading rules); ask.

Rules:
- You can only change DRAFT assessments, draft weeks, draft lessons and draft courses. Only the lecturer can publish, in the Kalami dashboard. If something is already published, ask the lecturer to move it back to draft before you edit it. You may add a new draft lesson to a published week; students see it only once the lecturer publishes it. When reordering, published weeks and lessons must keep their order (move only drafts around them).
- You can't delete courses, and you can only delete drafts nobody has worked on.
- For Drive readings: the lecturer connects Google once in the staff app. Call prepare_week_drive if the draft week has no folder, then get_course_outline until its drive has a url and syncing is absent (report drive.error if it fails). Use create_reading_document to write or revise a Google Doc there and attach it to the materials. Use the same documentKey for retries and revisions; revisions replace the entire document, including edits made in Google Docs. Never switch keys just to retry an error. Only the course's Drive owner may use these tools. Publish remains a human action.
- You cannot see students, attempts or grades. Never ask for student data.
- Pass a requestId (any unique string you make up) to create_course, create_assessment, add_questions, create_week, create_lesson, add_lesson_blocks and import_kalami_file. If such a call times out, retry it with the same requestId instead of calling it again without one.
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
          "The signed-in lecturer, their roles, and the universities they can create courses in.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) =>
        run(async () => {
          const me = await convex.query(api.mcp.whoami, auth(ctx));
          return me ?? "Not signed in to Kalami as staff. Reconnect Kalami and sign in again.";
        }),
    );

    server.registerTool(
      "list_courses",
      {
        title: "List courses",
        description:
          "Every course the lecturer can work on, with assessment counts and how many students joined. Put new work in one of these; get_course_outline shows a course's weeks and lessons.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => convex.query(api.mcp.listCourses, auth(ctx))),
    );

    server.registerTool(
      "get_course",
      {
        title: "Get course",
        description:
          "A course with all of its tasks, quizzes, midterms and finals (settings, status and the weekId a task or quiz sits in; not questions). For weeks and lessons use get_course_outline.",
        inputSchema: z.object({ courseId }),
      },
      async (args, ctx) =>
        run(() =>
          convex.query(api.mcp.getCourse, {
            ...auth(ctx),
            courseId: args.courseId as Id<"courses">,
          }),
        ),
    );

    server.registerTool(
      "create_course",
      {
        title: "Create course",
        description:
          "Creates a new, empty draft course owned by the lecturer. Only when the lecturer asks for a new course: students don't see it until they join it with its own code. Pass universityId only when whoami lists more than one university.",
        inputSchema: z.object({
          requestId,
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
            ...auth(ctx),
            requestId: args.requestId,
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
      "update_course",
      {
        title: "Update course",
        description:
          "Changes a draft course's title, description, semester or language. Once the lecturer publishes the course, only they can change these.",
        inputSchema: z.object({
          courseId,
          title: z.string().min(1).max(120).optional(),
          description: z.string().max(2000).optional(),
          semester: z.string().max(60).optional(),
          locale: z.enum(["ka", "en"]).optional().describe("Language of the course"),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateCourseAsAgent, {
            ...auth(ctx),
            courseId: args.courseId as Id<"courses">,
            title: args.title,
            description: args.description,
            semester: args.semester,
            locale: args.locale,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "create_assessment",
      {
        title: "Create assessment",
        description:
          "Creates a draft task (code sandbox homework), quiz, midterm or final in a course and returns its id and a reviewUrl for the lecturer. Then add_questions.",
        inputSchema: z.object({
          requestId,
          courseId,
          kind: z.enum(["task", "quiz", "midterm", "final"]),
          title: z.string().min(1).max(160),
          instructions: z.string().max(8000).optional().describe("Shown on the start screen"),
          settings: settingsSchema.optional(),
          weekId: weekId.optional().describe("Tasks and quizzes only: the week it belongs to. Leave out for midterms and finals"),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createAssessmentAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            courseId: args.courseId as Id<"courses">,
            kind: args.kind,
            title: args.title,
            instructions: args.instructions,
            settings: args.settings,
            weekId: args.weekId as Id<"weeks"> | undefined,
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
            ...auth(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
          }),
        ),
    );

    server.registerTool(
      "update_assessment",
      {
        title: "Update assessment",
        description:
          "Changes the title, instructions, kind or settings of a draft assessment. Changing the kind to midterm or final moves it out of its week into the Exams section.",
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
            ...auth(ctx),
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
      "delete_assessment",
      {
        title: "Delete assessment",
        description: "Deletes a draft task, quiz or exam with its questions. Only drafts no student has started.",
        inputSchema: z.object({ assessmentId }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deleteAssessmentAsAgent, {
            ...auth(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
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
          requestId,
          assessmentId,
          questions: z.array(questionSchema).min(1).max(50),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const ids = await convex.mutation(api.mcp.addQuestionsAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
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
        run(() => convex.query(api.mcp.checkCodeTask, { ...auth(ctx), question: args.question })),
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
            ...auth(ctx),
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
            ...auth(ctx),
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
        inputSchema: z.object({ assessmentId, questionIds: z.array(z.string()).min(1).max(200) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderQuestionsAsAgent, {
            ...auth(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
            questionIds: args.questionIds as Id<"questions">[],
          });
          return { ok: true };
        }),
    );

    // --- Course outline: weeks and lessons -------------------------------------------------

    server.registerTool(
      "get_course_outline",
      {
        title: "Get course outline",
        description:
          "The course week by week: each week's lessons (titles, block counts, status), links, Drive folder state and the tasks and quizzes placed in it; plus the Exams section (midterms, finals) and tasks/quizzes not placed in a week yet.",
        inputSchema: z.object({ courseId }),
      },
      async (args, ctx) =>
        run(() => convex.query(api.mcp.getCourseOutline, { ...auth(ctx), courseId: args.courseId as Id<"courses"> })),
    );

    server.registerTool(
      "create_week",
      {
        title: "Create week",
        description:
          'Adds a draft week at the end of the course outline. Title defaults to "Week N"; any title works ("Unit 2 · Forms"). Links are reading or video links for the week.',
        inputSchema: z.object({
          requestId,
          courseId,
          title: z.string().min(1).max(120).optional(),
          description: z.string().max(2000).optional().describe("One or two sentences students see under the title"),
          links: z.array(linkSchema).max(20).optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createWeekAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            courseId: args.courseId as Id<"courses">,
            title: args.title,
            description: args.description,
            links: args.links,
          });
          return { weekId: id, status: "draft", reviewUrl: dashboardUrl(ctx, `/courses/${args.courseId}`) };
        }),
    );

    server.registerTool(
      "update_week",
      {
        title: "Update week",
        description: "Renames a draft week or changes its description.",
        inputSchema: z.object({ weekId, title: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional() }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateWeekAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            title: args.title,
            description: args.description,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "reorder_weeks",
      {
        title: "Reorder weeks",
        description:
          "Sets the order of the course's weeks. Pass every week id exactly once. Published weeks must keep their order; move drafts around them.",
        inputSchema: z.object({ courseId, weekIds: z.array(z.string()).min(1).max(60) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderWeeksAsAgent, {
            ...auth(ctx),
            courseId: args.courseId as Id<"courses">,
            weekIds: args.weekIds as Id<"weeks">[],
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "delete_week",
      {
        title: "Delete week",
        description:
          "Deletes a draft week and its draft lessons. Its tasks and quizzes are kept and become unplaced; its Drive folder stays in the lecturer's Drive. Refused if the lecturer published any of its lessons.",
        inputSchema: z.object({ weekId }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deleteWeekAsAgent, { ...auth(ctx), weekId: args.weekId as Id<"weeks"> });
          return { ok: true };
        }),
    );

    server.registerTool(
      "list_reading_documents",
      {
        title: "List managed reading documents",
        description: "Lists a week's reading documentKeys and Google Doc links, including unfinished saves. Check this before creating or revising readings so you can reuse the correct key. linked=false means the save has not completed or the link was removed.",
        inputSchema: z.object({ weekId }),
      },
      async (args, ctx) => run(() => convex.query(api.readingDocuments.listForAgent, { ...auth(ctx), weekId: args.weekId as Id<"weeks"> })),
    );

    server.registerTool(
      "prepare_week_drive",
      {
        title: "Prepare a draft week's Google Drive folder",
        description: "Starts creating a private folder in the connected lecturer's Google Drive. Safe to call again after completion. Only the course's Drive owner may prepare it; the first caller becomes the owner if none exists. Google must already be connected in the staff app. Check get_course_outline for a Drive url, no syncing operation and no error before creating readings. Does not publish or share anything.",
        inputSchema: z.object({ weekId }),
      },
      async (args, ctx) => run(async () => {
        await convex.mutation(api.mcp.prepareWeekDriveAsAgent, { ...auth(ctx), weekId: args.weekId as Id<"weeks"> });
        return { ok: true, next: "Check get_course_outline; wait until the folder is ready before calling create_reading_document." };
      }),
    );

    server.registerTool(
      "create_reading_document",
      {
        title: "Create or update a reading document",
        description: "Creates a native Google Doc in a draft week's existing Drive folder and attaches it to the week's materials. Requires the course's Drive owner with Google connected. Reuse documentKey to update the SAME document (replaces its full content), or to retry after a timeout. Use a new key only for a different reading. Never publishes. Supports plain text, Markdown headings, bullet lists and fenced code; other Markdown is kept as literal text.",
        inputSchema: z.object({
          weekId,
          documentKey: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).describe("Stable name, e.g. html-reading. Keep this key for retries and revisions."),
          title: z.string().trim().min(1).max(200),
          content: z.string().trim().min(1).max(100_000),
        }),
      },
      async (args, ctx) => run(async () => ({
        ...await convex.action(api.readingDocuments.saveAsAgent, { ...auth(ctx), ...args, weekId: args.weekId as Id<"weeks"> }),
        reviewUrl: dashboardUrl(ctx, "/courses"),
        next: "Review the reading and publish its week in the staff dashboard when ready.",
      })),
    );

    server.registerTool(
      "add_week_links",
      {
        title: "Add week links",
        description: "Adds reading, video or website links to a draft week's materials (https only). Returns the link ids.",
        inputSchema: z.object({ weekId, links: z.array(linkSchema).min(1).max(20) }),
      },
      async (args, ctx) =>
        run(async () => ({
          linkIds: await convex.mutation(api.mcp.addWeekLinksAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            links: args.links,
          }),
        })),
    );

    server.registerTool(
      "remove_week_link",
      {
        title: "Remove week link",
        description: "Removes one link from a draft week.",
        inputSchema: z.object({ weekId, linkId: z.string() }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.removeWeekLinkAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            linkId: args.linkId,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "update_week_link",
      {
        title: "Update week link",
        description: "Changes one link of a draft week (title and https URL), keeping its place.",
        inputSchema: z.object({ weekId, linkId: z.string().describe("Link id from get_course_outline"), link: linkSchema }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateWeekLinkAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            linkId: args.linkId,
            link: args.link,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "reorder_week_links",
      {
        title: "Reorder week links",
        description: "Sets the order of a draft week's links. Pass every link id exactly once.",
        inputSchema: z.object({ weekId, linkIds: z.array(z.string()).min(1).max(20) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderWeekLinksAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            linkIds: args.linkIds,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "place_assessment",
      {
        title: "Place assessment",
        description:
          "Puts a draft task or quiz into a week of its course, or (weekId null) back among the unplaced. Midterms and finals always stay in the Exams section.",
        inputSchema: z.object({ assessmentId, weekId: weekId.nullable().describe("The week, or null to unplace it") }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.placeAssessmentAsAgent, {
            ...auth(ctx),
            assessmentId: args.assessmentId as Id<"assessments">,
            weekId: args.weekId as Id<"weeks"> | null,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "create_lesson",
      {
        title: "Create lesson",
        description:
          "Creates a draft lesson at the end of a week, optionally with its first blocks (up to 50; add more with add_lesson_blocks). Returns its id and a reviewUrl.",
        inputSchema: z.object({
          requestId,
          weekId,
          title: z.string().min(1).max(160),
          blocks: z.array(lessonBlockSchema).max(50).optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createLessonAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            weekId: args.weekId as Id<"weeks">,
            title: args.title,
            blocks: args.blocks,
          });
          const lesson = await convex.query(api.mcp.getLessonAsAgent, { ...auth(ctx), lessonId: id });
          return {
            lessonId: id,
            status: "draft",
            blockIds: lesson.blocks.map((block) => block.id),
            reviewUrl: dashboardUrl(ctx, `/courses/${lesson.courseId}/lessons/${id}`),
          };
        }),
    );

    server.registerTool(
      "create_presentation",
      {
        title: "Create presentation",
        description: [
          "Creates a draft presentation in a week: a deck of typed slides in one of five themes. Students watch it in Kalami's player and the lecturer presents it full screen; each slide type has its own designed layout and animation, so you only choose types and write the words (nothing is positioned or coloured by hand).",
          "Design it like a great speaker, not a document: one idea per slide; very few words (a statement under 15 words, points under 10 words each); 8 to 20 slides; open with a title slide, put a section slide before each part, end with a closing slide; mix types (statement, number, diagram, compare, quote, code, image) rather than many points slides; mark one or two key words per slide with **double asterisks**; give one or two big moments tone \"accent\"; use build: true on points or diagrams the lecturer should reveal one by one; add speaker notes saying what to say.",
          "Returns the presentation id, its slide ids and a reviewUrl. It starts as a draft: the lecturer reviews and publishes it.",
        ].join(" "),
        inputSchema: z.object({
          requestId,
          weekId,
          title: z.string().min(1).max(160).describe("The presentation's name in the course outline"),
          theme: deckThemeSchema.optional().describe(`Defaults to ink. ${deckThemeSchema.description ?? ""}`),
          slides: slidesSchema,
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const id = await convex.mutation(api.mcp.createPresentationAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            weekId: args.weekId as Id<"weeks">,
            title: args.title,
            theme: args.theme,
            slides: args.slides,
          });
          const deck = await convex.query(api.mcp.getPresentationAsAgent, { ...auth(ctx), presentationId: id });
          return {
            presentationId: id,
            status: "draft",
            slideIds: deck.slides.map((slide) => slide.id),
            reviewUrl: dashboardUrl(ctx, `/courses/${deck.courseId}/presentations/${id}`),
          };
        }),
    );

    server.registerTool(
      "get_presentation",
      {
        title: "Get presentation",
        description:
          "A presentation with its theme and every slide (with its id), its week and status, and shareLink: its public link while the lecturer shares it (null otherwise).",
        inputSchema: z.object({ presentationId }),
      },
      async (args, ctx) =>
        run(async () => {
          const { share, canShare, ...deck } = await convex.query(api.mcp.getPresentationAsAgent, {
            ...auth(ctx),
            presentationId: args.presentationId as Id<"presentations">,
          });
          void canShare;
          // The link, not its token: anyone with it can watch, no account needed.
          const shareLink = share && { url: presentationShareUrl(share.token), speakerNotes: share.notes, sharedBy: share.by };
          return { ...deck, shareLink };
        }),
    );

    server.registerTool(
      "update_presentation",
      {
        title: "Update presentation",
        description:
          "Changes a draft presentation: its title, its theme and/or its slides. slides replaces every slide at once: to keep a slide as it is, send it with its id from get_presentation; leave slides out to change only the title or theme. Returns the slide ids.",
        inputSchema: z.object({
          presentationId,
          title: z.string().min(1).max(160).optional(),
          theme: deckThemeSchema.optional(),
          slides: slidesSchema.optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          const ids = await convex.mutation(api.mcp.updatePresentationAsAgent, {
            ...auth(ctx),
            presentationId: args.presentationId as Id<"presentations">,
            title: args.title,
            theme: args.theme,
            slides: args.slides,
          });
          return { slideIds: ids };
        }),
    );

    server.registerTool(
      "move_presentation",
      {
        title: "Move presentation",
        description:
          "Moves a draft presentation up or down within its week, or to the end of another week of the same course (weekId). Published presentations, and drafts next to them, are the lecturer's to move.",
        inputSchema: z.object({
          presentationId,
          weekId: weekId.optional().describe("Move it to the end of this week"),
          direction: z.enum(["up", "down"]).optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.movePresentationAsAgent, {
            ...auth(ctx),
            presentationId: args.presentationId as Id<"presentations">,
            weekId: args.weekId as Id<"weeks"> | undefined,
            direction: args.direction,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "reorder_presentations",
      {
        title: "Reorder presentations",
        description:
          "Sets the order of a week's presentations. Pass every presentation id of the week exactly once. Published presentations must keep their order; move drafts around them.",
        inputSchema: z.object({ weekId, presentationIds: z.array(z.string()).min(1).max(20) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderPresentationsAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            presentationIds: args.presentationIds as Id<"presentations">[],
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "delete_presentation",
      {
        title: "Delete presentation",
        description: "Deletes a draft presentation. Published presentations can only be deleted by the lecturer.",
        inputSchema: z.object({ presentationId }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deletePresentationAsAgent, {
            ...auth(ctx),
            presentationId: args.presentationId as Id<"presentations">,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "get_lesson",
      {
        title: "Get lesson",
        description: "A lesson with every block (and its id), its week and status.",
        inputSchema: z.object({ lessonId }),
      },
      async (args, ctx) =>
        run(() => convex.query(api.mcp.getLessonAsAgent, { ...auth(ctx), lessonId: args.lessonId as Id<"lessons"> })),
    );

    server.registerTool(
      "update_lesson",
      {
        title: "Update lesson",
        description: "Renames a draft lesson.",
        inputSchema: z.object({ lessonId, title: z.string().min(1).max(160) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateLessonAsAgent, {
            ...auth(ctx),
            lessonId: args.lessonId as Id<"lessons">,
            title: args.title,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "add_lesson_blocks",
      {
        title: "Add lesson blocks",
        description:
          "Inserts up to 50 blocks into a draft lesson at position (0-based; default: the end). Returns the new block ids.",
        inputSchema: z.object({
          requestId,
          lessonId,
          blocks: z.array(lessonBlockSchema).min(1).max(50),
          position: z.number().int().min(0).optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => ({
          blockIds: await convex.mutation(api.mcp.addLessonBlocksAsAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            lessonId: args.lessonId as Id<"lessons">,
            blocks: args.blocks,
            position: args.position,
          }),
        })),
    );

    server.registerTool(
      "update_lesson_block",
      {
        title: "Update lesson block",
        description: "Replaces one block of a draft lesson (it keeps its id and place). The block may change type.",
        inputSchema: z.object({ lessonId, blockId: z.string(), block: lessonBlockSchema }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.updateLessonBlockAsAgent, {
            ...auth(ctx),
            lessonId: args.lessonId as Id<"lessons">,
            blockId: args.blockId,
            block: args.block,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "delete_lesson_block",
      {
        title: "Delete lesson block",
        description: "Removes one block from a draft lesson.",
        inputSchema: z.object({ lessonId, blockId: z.string() }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deleteLessonBlockAsAgent, {
            ...auth(ctx),
            lessonId: args.lessonId as Id<"lessons">,
            blockId: args.blockId,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "replace_lesson_blocks",
      {
        title: "Replace lesson blocks",
        description:
          "Rewrites a draft lesson: its blocks become exactly these, in this order (up to 150). Pass a block's id to keep it.",
        inputSchema: z.object({ lessonId, blocks: z.array(lessonBlockSchema).max(150) }),
      },
      async (args, ctx) =>
        run(async () => ({
          blockIds: await convex.mutation(api.mcp.setLessonBlocksAsAgent, {
            ...auth(ctx),
            lessonId: args.lessonId as Id<"lessons">,
            blocks: args.blocks,
          }),
        })),
    );

    server.registerTool(
      "move_lesson",
      {
        title: "Move lesson",
        description: "Moves a draft lesson up or down within its week, or to the end of another week (weekId).",
        inputSchema: z.object({
          lessonId,
          weekId: weekId.optional().describe("Move it to the end of this week"),
          direction: z.enum(["up", "down"]).optional(),
        }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.moveLessonAsAgent, {
            ...auth(ctx),
            lessonId: args.lessonId as Id<"lessons">,
            weekId: args.weekId as Id<"weeks"> | undefined,
            direction: args.direction,
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "reorder_lessons",
      {
        title: "Reorder lessons",
        description:
          "Sets the order of a week's lessons. Pass every lesson id of the week exactly once. Published lessons must keep their order; move drafts around them.",
        inputSchema: z.object({ weekId, lessonIds: z.array(z.string()).min(1).max(30) }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.reorderLessonsAsAgent, {
            ...auth(ctx),
            weekId: args.weekId as Id<"weeks">,
            lessonIds: args.lessonIds as Id<"lessons">[],
          });
          return { ok: true };
        }),
    );

    server.registerTool(
      "delete_lesson",
      {
        title: "Delete lesson",
        description: "Deletes a draft lesson.",
        inputSchema: z.object({ lessonId }),
      },
      async (args, ctx) =>
        run(async () => {
          await convex.mutation(api.mcp.deleteLessonAsAgent, { ...auth(ctx), lessonId: args.lessonId as Id<"lessons"> });
          return { ok: true };
        }),
    );

    // --- .kalami course files -----------------------------------------------------------

    const fileContent = z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .describe("The whole .kalami file: its JSON text, or the JSON object itself");
    const asText = (content: string | Record<string, unknown>) =>
      typeof content === "string" ? content : JSON.stringify(content);

    server.registerTool(
      "get_kalami_format",
      {
        title: "Get the .kalami format",
        description:
          "The guide to writing a .kalami course file (a whole course as one JSON file: weeks, lessons, links, quizzes, tasks, exams), with examples, plus its JSON Schema. Read it before writing a file.",
        inputSchema: z.object({}),
      },
      async () =>
        run(async () => ({
          guide: KALAMI_GUIDE,
          guideUrl: KALAMI_GUIDE_URL,
          schemaUrl: KALAMI_SCHEMA_URL,
          schema: z.toJSONSchema(anyKalamiFileSchema, { io: "input", unrepresentable: "any" }),
        })),
    );

    server.registerTool(
      "export_course_file",
      {
        title: "Export course file",
        description:
          "The course as a signed .kalami file (fileName and content). Give it to the lecturer as a file. It contains every answer key: only share it with staff.",
        inputSchema: z.object({ courseId }),
      },
      async (args, ctx) =>
        run(() => convex.query(api.mcp.exportCourseForAgent, { ...auth(ctx), courseId: args.courseId as Id<"courses"> })),
    );

    server.registerTool(
      "export_presentation_file",
      {
        title: "Export presentation file",
        description:
          "One presentation as a signed .kalami file (fileName and content), to move it to another course, another lecturer or another Kalami site. Give it to the lecturer as a file named fileName.",
        inputSchema: z.object({ presentationId }),
      },
      async (args, ctx) =>
        run(() =>
          convex.query(api.mcp.exportPresentationForAgent, {
            ...auth(ctx),
            presentationId: args.presentationId as Id<"presentations">,
          }),
        ),
    );

    server.registerTool(
      "import_presentation_file",
      {
        title: "Import presentation file",
        description:
          "Puts the presentation in a .kalami presentation file (kind \"presentation\") into a week, at its end, as a new draft. If the file has problems nothing is created and every problem is listed. A course file is refused: use import_kalami_file for those.",
        inputSchema: z.object({ requestId, weekId, content: fileContent }),
      },
      async (args, ctx) =>
        run(async () => {
          const result = await convex.mutation(api.mcp.importPresentationForAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            weekId: args.weekId as Id<"weeks">,
            text: asText(args.content),
          });
          if (!result.ok) return result;
          const deck = await convex.query(api.mcp.getPresentationAsAgent, { ...auth(ctx), presentationId: result.presentationId });
          return { ...result, reviewUrl: dashboardUrl(ctx, `/courses/${deck.courseId}/presentations/${result.presentationId}`) };
        }),
    );

    server.registerTool(
      "check_kalami_file",
      {
        title: "Check .kalami file",
        description:
          "Dry run: checks a .kalami file the way an import would (format, every block, question and setting) and returns what it contains, or every problem with where it is. Creates nothing.",
        inputSchema: z.object({ content: fileContent }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.checkKalamiForAgent, { ...auth(ctx), text: asText(args.content) })),
    );

    server.registerTool(
      "import_kalami_file",
      {
        title: "Import .kalami file",
        description:
          "Creates the file's course as a NEW draft course for the lecturer (never merges into an existing one), with all its weeks, lessons and assessments as drafts. Run check_kalami_file first. Pass universityId only when whoami lists more than one university (null for none).",
        inputSchema: z.object({ requestId, content: fileContent, universityId: z.string().nullable().optional() }),
      },
      async (args, ctx) =>
        run(async () => {
          const result = await convex.action(api.mcp.importKalamiForAgent, {
            ...auth(ctx),
            requestId: args.requestId,
            text: asText(args.content),
            universityId: args.universityId as Id<"universities"> | null | undefined,
          });
          return result.ok ? { ...result, reviewUrl: dashboardUrl(ctx, `/courses/${result.courseId}`) } : result;
        }),
    );
  },
  {
    serverInfo: { name: "kalami", version: "0.11.0" },
    instructions: INSTRUCTIONS,
  },
);

/**
 * Checks the bearer token of an MCP request: a Clerk OAuth access token from
 * "Sign in with Kalami". It becomes a short signed credential that tells Convex
 * which Clerk user this is, and Convex decides whether the person is staff: a
 * student who signs in gets undefined here, so a 401.
 */
export async function verifyToken(req: Request, token: string | undefined): Promise<AuthInfo | undefined> {
  if (!token) {
    return undefined;
  }
  const oauth = await verifyOAuthToken(req).catch((error: unknown) => {
    console.error("MCP OAuth token check failed", error);
    return null;
  });
  if (oauth === null) {
    return undefined;
  }
  const credential = await serviceCredential(oauth.userId);
  const me = await convex.query(api.mcp.whoami, { token: credential, client: oauth.clientId });
  if (me === null) {
    return undefined;
  }
  return {
    token: credential,
    clientId: me.userId,
    scopes: oauth.scopes,
    extra: { email: me.email, origin: publicOrigin(req), client: oauth.clientId },
  };
}

/** Serves an MCP request for a caller that was already verified (used by the tests). */
export function handleVerified(req: Request, authInfo: AuthInfo): Promise<Response> {
  // mcp-handler reads the caller from `req.auth`, the same field withMcpAuth sets.
  (req as Request & { auth?: AuthInfo }).auth = authInfo;
  return handler(req);
}

/** /api/mcp: bearer tokens are checked against Convex; anything else is a 401. */
export const headerAuthHandler = withMcpAuth(handler, verifyToken, { required: true });
