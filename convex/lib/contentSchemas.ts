import { z } from "zod";
import {
  EMPHASIS_EFFECTS,
  ENTER_EFFECTS,
  EXIT_EFFECTS,
  SCENE_ALIGNS,
  SCENE_CODE_LANGUAGES,
  SCENE_COLORS,
  SCENE_LIMITS,
  SCENE_SHAPES,
  SCENE_SIZES,
  SCENE_STAGE,
  SCENE_THEMES,
  SCENE_TONES,
  sceneProblems,
  type Scene,
} from "./scene";

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

/** A full https:// link: Kalami refuses anything else for links, images and videos. */
const httpsUrl = z
  .string()
  .max(2000)
  .url()
  .regex(/^https:\/\//i, "Use a full link that starts with https://");

export const linkSchema = z.object({
  title: z.string().min(1).max(120).describe('What students click, e.g. "Chapter 2 reading"'),
  url: httpsUrl.describe("https only"),
});

export const markdown = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .describe("Markdown: paragraphs, **bold**, *italic*, `code`, [links](https://…), - lists, 1. lists, ### headings");
const blockId = z.string().max(40).optional().describe("Only to keep an existing block when replacing blocks");

// --- Animated scenes (lib/scene/index.ts has the rules; sceneProblems runs on every scene) ------

const sceneId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/)
  .describe('A short unique id, lowercase: "title", "box-1"');
const sceneColor = z.enum(SCENE_COLORS).describe("A Kalami colour token");
const sceneSize = z.enum(SCENE_SIZES).describe("Type size; md if left out");
const sceneBox = {
  x: z.number().min(0).max(SCENE_STAGE.width).describe(`Left edge, 0 to ${SCENE_STAGE.width}`),
  y: z.number().min(0).max(SCENE_STAGE.height).describe(`Top edge, 0 to ${SCENE_STAGE.height}`),
  w: z.number().min(16).max(SCENE_STAGE.width).optional().describe("Width; a sensible default per kind if left out"),
  h: z.number().min(16).max(SCENE_STAGE.height).optional().describe("Height; a sensible default per kind if left out"),
};
const sceneText = z.string().min(1).max(SCENE_LIMITS.text);
const sceneMd = z.string().min(1).max(SCENE_LIMITS.md).describe("Markdown, short");
const sceneLabel = z.string().max(SCENE_LIMITS.label).optional();

export const sceneElementSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        id: sceneId,
        kind: z.literal("heading"),
        text: sceneText,
        size: sceneSize.optional(),
        align: z.enum(SCENE_ALIGNS).optional(),
        color: sceneColor.optional(),
        ...sceneBox,
      })
      .describe("A big line of text; cascades in letter by letter"),
    z
      .object({
        id: sceneId,
        kind: z.literal("text"),
        md: sceneMd,
        size: sceneSize.optional(),
        align: z.enum(SCENE_ALIGNS).optional(),
        color: sceneColor.optional(),
        ...sceneBox,
      })
      .describe("A short paragraph"),
    z
      .object({
        id: sceneId,
        kind: z.literal("list"),
        items: z.array(sceneText).min(1).max(SCENE_LIMITS.listItems).describe("Markdown items; they reveal one by one"),
        ordered: z.boolean().optional(),
        size: sceneSize.optional(),
        color: sceneColor.optional(),
        ...sceneBox,
      })
      .describe("A list whose items arrive one after another"),
    z
      .object({
        id: sceneId,
        kind: z.literal("code"),
        language: z.enum(SCENE_CODE_LANGUAGES),
        code: z
          .string()
          .min(1)
          .max(SCENE_LIMITS.code)
          .describe(`A fragment, at most ${SCENE_LIMITS.codeLines} lines; it types itself line by line`),
        size: sceneSize.optional(),
        ...sceneBox,
      })
      .describe("A code window"),
    z
      .object({
        id: sceneId,
        kind: z.literal("image"),
        url: httpsUrl,
        alt: sceneText.describe("What the image shows, for screen readers"),
        fit: z.enum(["cover", "contain"]).optional(),
        ...sceneBox,
      })
      .describe("A picture"),
    z
      .object({
        id: sceneId,
        kind: z.literal("shape"),
        shape: z.enum(SCENE_SHAPES),
        fill: sceneColor.optional().describe("Background; highlighter if left out"),
        stroke: sceneColor.optional().describe("Outline colour; none if left out"),
        label: sceneLabel.describe("Text centred in the shape"),
        color: sceneColor.optional().describe("Label colour"),
        ...sceneBox,
      })
      .describe("A box, circle, pill or diamond, with an optional label: the nodes of a diagram"),
    z
      .object({
        id: sceneId,
        kind: z.literal("arrow"),
        from: sceneId.describe("The element it starts at"),
        to: sceneId.describe("The element it points to"),
        label: sceneLabel,
        color: sceneColor.optional(),
        curve: z.number().min(-1).max(1).optional().describe("Bow the arrow sideways: 0 straight, 0.3 gentle, 1 strong; negative bows the other way"),
      })
      .describe("An arrow between two elements; it draws itself and follows them when they move"),
    z
      .object({
        id: sceneId,
        kind: z.literal("number"),
        value: z.number().describe("The number it counts up to"),
        label: sceneLabel.describe("What the number is, under it"),
        prefix: sceneLabel,
        suffix: sceneLabel.describe('e.g. "%" or " ms"'),
        decimals: z.number().int().min(0).max(4).optional(),
        size: sceneSize.optional(),
        color: sceneColor.optional(),
        ...sceneBox,
      })
      .describe("A big number that counts up when it enters"),
    z
      .object({ id: sceneId, kind: z.literal("note"), tone: z.enum(SCENE_TONES), md: sceneMd, ...sceneBox })
      .describe("A small callout chip: a tip, definition, warning or note"),
  ])
  .describe("One element on the stage");

const sceneTargets = z.array(sceneId).max(SCENE_LIMITS.targetsPerAction).describe("Element ids");
const sceneTiming = {
  at: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe("Seconds after the step starts; left out, actions follow each other with a little overlap"),
  duration: z.number().min(0.1).max(6).optional().describe("Seconds; each effect has its own default"),
};
const sceneStagger = z
  .number()
  .min(0)
  .max(1)
  .optional()
  .describe("Seconds between targets (and between letters, items or lines of a cascade)");

export const sceneActionSchema = z
  .discriminatedUnion("do", [
    z
      .object({
        do: z.literal("enter"),
        targets: sceneTargets.min(1),
        effect: z
          .enum(ENTER_EFFECTS)
          .optional()
          .describe(
            "Left out, each kind picks its own: headings and lists cascade, code types, arrows draw, numbers count, the rest pop or rise",
          ),
        stagger: sceneStagger,
        ...sceneTiming,
      })
      .describe("Bring elements onto the stage. Elements no step enters are there from the start"),
    z
      .object({
        do: z.literal("exit"),
        targets: sceneTargets.min(1),
        effect: z.enum(EXIT_EFFECTS).optional(),
        stagger: sceneStagger,
        ...sceneTiming,
      })
      .describe("Take elements off the stage"),
    z
      .object({ do: z.literal("emphasize"), targets: sceneTargets.min(1), effect: z.enum(EMPHASIS_EFFECTS).optional(), ...sceneTiming })
      .describe("Draw the eye to elements that are already there"),
    z
      .object({ do: z.literal("focus"), targets: sceneTargets, ...sceneTiming })
      .describe("Dim everything but the targets; an empty targets list lifts the focus"),
    z
      .object({
        do: z.literal("move"),
        target: sceneId,
        x: z.number().min(0).max(SCENE_STAGE.width).optional(),
        y: z.number().min(0).max(SCENE_STAGE.height).optional(),
        w: z.number().min(16).max(SCENE_STAGE.width).optional(),
        h: z.number().min(16).max(SCENE_STAGE.height).optional(),
        ...sceneTiming,
      })
      .describe("Glide an element to a new place or size; arrows attached to it follow"),
    z
      .object({
        do: z.literal("camera"),
        target: sceneId.optional().describe("Zoom in on this element"),
        x: z.number().min(0).max(SCENE_STAGE.width).optional().describe("Or centre the camera here (with y and scale)"),
        y: z.number().min(0).max(SCENE_STAGE.height).optional(),
        scale: z.number().min(1).max(4).optional().describe("The zoom (1 = the whole stage)"),
        ...sceneTiming,
      })
      .describe("Move the camera: frame an element or a point; with nothing given, back to the whole stage"),
  ])
  .describe("One animation in a step");

export const sceneSchema = z
  .object({
    title: z.string().max(SCENE_LIMITS.title).optional().describe("Shown as the slide's label"),
    theme: z.enum(SCENE_THEMES).optional().describe("paper: light stage (default); ink: dark stage"),
    elements: z
      .array(sceneElementSchema)
      .min(1)
      .max(SCENE_LIMITS.elements)
      .describe(`Everything on the ${SCENE_STAGE.width} x ${SCENE_STAGE.height} stage`),
    steps: z
      .array(
        z.object({
          note: z.string().max(SCENE_LIMITS.note).optional().describe("A caption under the stage while this step is shown"),
          actions: z.array(sceneActionSchema).min(1).max(SCENE_LIMITS.actionsPerStep),
        }),
      )
      .min(1)
      .max(SCENE_LIMITS.steps)
      .describe("Students click through the steps in order; each runs its actions"),
  })
  .superRefine((scene, ctx) => {
    for (const problem of sceneProblems(scene as Scene)) ctx.addIssue({ code: "custom", message: problem });
  })
  .describe("An animated scene");

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
        url: httpsUrl.describe("https URL of the image"),
        alt: z.string().min(1).max(300).describe("What the image shows, for screen readers. Required."),
        caption: z.string().max(300).optional(),
      })
      .describe("An image"),
    z
      .object({
        id: blockId,
        type: z.literal("video"),
        url: httpsUrl.describe("YouTube or Vimeo links play inside the lesson; any other https link is shown as a link"),
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
    z
      .object({ id: blockId, type: z.literal("scene"), scene: sceneSchema })
      .describe(
        "An animated scene: elements on a stage and steps that animate them. Students click through the steps (arrow keys work too)",
      ),
  ])
  .describe("One lesson block");
