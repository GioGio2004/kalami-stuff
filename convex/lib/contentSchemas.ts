import { z } from "zod";

/**
 * The shapes of course content (assessment settings, questions, code tasks,
 * lesson blocks, links) as zod schemas with descriptions. One definition
 * serves three readers: the MCP tools (lib/mcp/server.ts), the .kalami file
 * format (lib/kalami.ts) and its published JSON Schema. The Convex validators
 * in lib/validators.ts check the same things on every write; keep them in step.
 */

export const settingsSchema = z
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

export const prompt = z.string().min(1).max(4000).describe("The question text, Markdown allowed");
export const points = z.number().min(0).max(100).optional().describe("Defaults to 1");
export const explanation = z
  .string()
  .max(2000)
  .optional()
  .describe("Shown to students with full results after the assessment closes");
export const choiceOptions = z
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

export const checkSchema = z.discriminatedUnion("type", [
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

export const codeFile = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*\.(html|css)$/).describe('"index.html" or "style.css"'),
  content: z.string().max(50_000),
});

export const codeQuestion = z.object({
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

export const questionSchema = z.discriminatedUnion("type", [
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

export const linkSchema = z.object({
  title: z.string().min(1).max(120).describe('What students click, e.g. "Chapter 2 reading"'),
  url: z.string().url().max(2000).describe("https only"),
});

export const markdown = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .describe("Markdown: paragraphs, **bold**, *italic*, `code`, [links](https://…), - lists, 1. lists, ### headings");
const blockId = z.string().max(40).optional().describe("Only to keep an existing block when replacing blocks");

export const lessonBlockSchema = z
  .discriminatedUnion("type", [
    z.object({ id: blockId, type: z.literal("text"), md: markdown(20_000) }).describe("Explanation text. One idea per block."),
    z
      .object({
        id: blockId,
        type: z.literal("callout"),
        tone: z
          .enum(["tip", "definition", "warning", "note"])
          .describe("definition: a key term; tip: practical advice; warning: a common mistake; note: an aside"),
        title: z.string().max(120).optional().describe('e.g. the term being defined: "Selector"'),
        md: markdown(5_000),
      })
      .describe("A highlighted box"),
    z
      .object({
        id: blockId,
        type: z.literal("code"),
        language: z.enum([
          "html",
          "css",
          "javascript",
          "typescript",
          "python",
          "java",
          "c",
          "cpp",
          "csharp",
          "php",
          "sql",
          "json",
          "bash",
          "text",
        ]),
        code: z.string().min(1).max(20_000),
        caption: z.string().max(300).optional(),
        preview: z.boolean().optional().describe("html/css only: also show the rendered result next to the code"),
      })
      .describe("A code example"),
    z
      .object({
        id: blockId,
        type: z.literal("image"),
        url: z.string().url().describe("https URL of the image"),
        alt: z.string().min(1).max(300).describe("What the image shows, for screen readers. Required."),
        caption: z.string().max(300).optional(),
      })
      .describe("An image"),
    z
      .object({
        id: blockId,
        type: z.literal("video"),
        url: z.string().url().describe("YouTube or Vimeo links play inside the lesson; any other https link is shown as a link"),
        caption: z.string().max(300).optional(),
      })
      .describe("A video"),
    z
      .object({
        id: blockId,
        type: z.literal("steps"),
        title: z.string().max(120).optional(),
        steps: z
          .array(z.object({ title: z.string().max(120).optional(), md: markdown(3_000) }))
          .min(1)
          .max(20),
      })
      .describe("A procedure students reveal one step at a time"),
    z
      .object({
        id: blockId,
        type: z.literal("check"),
        check: z.object({
          kind: z.enum(["single", "multiple", "short"]),
          prompt: z.string().min(1).max(2000),
          options: z
            .array(z.object({ text: z.string().min(1).max(300), correct: z.boolean() }))
            .min(2)
            .max(8)
            .optional()
            .describe("single: exactly one correct; multiple: at least one correct"),
          accepted: z.array(z.string().min(1).max(200)).min(1).max(20).optional().describe("short: answers that count as right"),
          explanation: z.string().max(2000).optional().describe("Shown after the student answers"),
        }),
      })
      .describe("A quick ungraded self-check question; students see right away whether they got it"),
  ])
  .describe("One lesson block");
