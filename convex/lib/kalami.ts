import { z } from "zod";
import { deckThemeSchema, lessonBlockSchema, linkSchema, questionSchema, settingsSchema, slidesSchema } from "./contentSchemas";

/**
 * The .kalami file format, version 1: a whole course in one UTF-8 JSON file.
 *
 *   { "$schema", "format": "kalami", "version": 1, "kind": "course",
 *     "exported"?: { by, at, from }, "signature"?: "…", "course": { … } }
 *
 * The course is its outline: weeks (lessons, presentations, links, tasks and quizzes) and the
 * exams. Files carry no students, attempts, grades, groups, join codes, dates
 * or Drive permissions; importing always creates a new draft course.
 *
 * Kalami signs the files it exports (HMAC over the canonical content, see
 * signedPart). An unchanged file shows "Verified by Kalami" on import; a file
 * an AI or a person wrote or edited is still welcome, just unverified.
 *
 * Version 1 is JSON so people and AI assistants can write it directly. A later
 * version can become a zip with bundled images and documents; the "version"
 * field tells them apart. The full guide for authors is KALAMI-FORMAT.md
 * (served at /kalami-format), the JSON Schema at /kalami.schema.json.
 */

export const KALAMI_FORMAT = "kalami";
export const KALAMI_VERSION = 1;
export const KALAMI_MIME = "application/vnd.kalami+json";
export const KALAMI_EXTENSION = ".kalami";
export const KALAMI_SCHEMA_URL = "https://staff.kalami.space/kalami.schema.json";
export const KALAMI_GUIDE_URL = "https://staff.kalami.space/kalami-format";
/** Comfortably below Convex's argument limit; a big course is a few hundred KB. */
export const MAX_KALAMI_BYTES = 4 * 1024 * 1024;

const text = (max: number) => z.string().trim().min(1).max(max);

/** A task or quiz (in a week) or a midterm or final (in exams): settings, never dates. */
const assessmentFileSchema = z.object({
  kind: z.enum(["task", "quiz", "midterm", "final"]),
  title: text(160),
  instructions: z.string().max(8000).optional().describe("Shown on the start screen"),
  settings: settingsSchema
    .omit({ opensAt: true, closesAt: true })
    .optional()
    .describe("Optional; Kalami's defaults for the kind fill the rest. Dates are never in files: the lecturer sets them after import."),
  questions: z.array(questionSchema).max(200).describe("In order. Correct answers are marked inside each question."),
});

const lessonFileSchema = z.object({
  title: text(160),
  blocks: z.array(lessonBlockSchema).max(150).describe("The lesson, in order"),
});

const presentationFileSchema = z.object({
  title: text(160),
  theme: deckThemeSchema.optional().describe("Defaults to ink"),
  slides: slidesSchema,
});

const weekFileSchema = z.object({
  title: text(120).describe('"Week 1", or any title: "Unit 2 · Forms"'),
  description: z.string().max(2000).optional().describe("One or two sentences students see under the title"),
  lessons: z.array(lessonFileSchema).max(30).default([]),
  presentations: z
    .array(presentationFileSchema)
    .max(20)
    .default([])
    .describe("The week's presentations: decks of typed slides in a theme"),
  links: z.array(linkSchema).max(20).default([]).describe("Readings, videos, websites for the week"),
  driveFolder: z
    .string()
    .url()
    .optional()
    .describe("Informational only: the exporting lecturer's Drive folder for this week. Import never connects to it."),
  assessments: z
    .array(assessmentFileSchema.extend({ kind: z.enum(["task", "quiz"]) }))
    .max(30)
    .default([])
    .describe("The week's tasks and quizzes"),
});

export const courseFileSchema = z.object({
  title: text(120),
  description: z.string().max(2000).optional(),
  semester: z.string().max(60).optional().describe('e.g. "Spring 2027"'),
  language: z.enum(["ka", "en"]).describe("ka = Georgian, en = English: what the content is written in"),
  weeks: z.array(weekFileSchema).max(60).default([]),
  exams: z
    .array(assessmentFileSchema.extend({ kind: z.enum(["midterm", "final"]) }))
    .max(10)
    .default([])
    .describe("Midterms and finals"),
  other: z
    .array(assessmentFileSchema.extend({ kind: z.enum(["task", "quiz"]) }))
    .max(60)
    .default([])
    .describe("Tasks and quizzes not placed in a week"),
});

export const kalamiFileSchema = z
  .object({
    $schema: z.string().optional(),
    format: z.literal(KALAMI_FORMAT).describe('Always "kalami"'),
    version: z.literal(KALAMI_VERSION).describe("Always 1 for this format"),
    kind: z.literal("course"),
    exported: z
      .object({
        by: z.string().max(200).describe("Who exported it"),
        at: z.string().max(40).describe("ISO 8601 time"),
        from: z.string().max(200).describe('"Kalami", or the tool that wrote the file'),
      })
      .optional()
      .describe("Set by Kalami on export; an AI may set from to its own name"),
    signature: z.string().max(200).optional().describe("Set by Kalami on export only. Leave it out when you write a file."),
    course: courseFileSchema,
  })
  .describe("A Kalami course file (.kalami), version 1");

export type KalamiFile = z.infer<typeof kalamiFileSchema>;
export type KalamiCourse = KalamiFile["course"];
export type KalamiAssessment = z.infer<typeof assessmentFileSchema>;

export type KalamiSummary = {
  title: string;
  language: "ka" | "en";
  weeks: number;
  lessons: number;
  presentations: number;
  assessments: { task: number; quiz: number; midterm: number; final: number };
  questions: number;
  links: number;
  exported?: { by: string; at: string; from: string };
};

/** Counts for the preview card. */
export function summarize(file: KalamiFile): KalamiSummary {
  const all = [
    ...file.course.weeks.flatMap((week) => week.assessments),
    ...file.course.exams,
    ...file.course.other,
  ];
  const assessments = { task: 0, quiz: 0, midterm: 0, final: 0 };
  for (const a of all) assessments[a.kind]++;
  return {
    title: file.course.title,
    language: file.course.language,
    weeks: file.course.weeks.length,
    lessons: file.course.weeks.reduce((n, week) => n + week.lessons.length, 0),
    presentations: file.course.weeks.reduce((n, week) => n + week.presentations.length, 0),
    assessments,
    questions: all.reduce((n, a) => n + a.questions.length, 0),
    links: file.course.weeks.reduce((n, week) => n + week.links.length, 0),
    exported: file.exported,
  };
}

/** Where a zod issue is, in words: "course › weeks[2] › lessons[0] › blocks[3] › md". */
function where(path: PropertyKey[]): string {
  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""}[${segment}]`;
    } else {
      parts.push(String(segment));
    }
  }
  return parts.join(" › ") || "file";
}

export type KalamiParse =
  | { ok: true; file: KalamiFile }
  | { ok: false; errors: string[] };

/**
 * Reads a .kalami file's text: JSON, then the version-1 shape. Errors come back
 * as at most 20 short lines a person or an agent can fix ("course › weeks[1] ›
 * title: Too small…"). The deeper rules (one correct option, code task
 * solutions that pass their checks, image alt text…) are checked again when
 * the content is created, exactly as for the web app.
 */
export function parseKalami(raw: string): KalamiParse {
  if (raw.length > MAX_KALAMI_BYTES) {
    return { ok: false, errors: [`The file is larger than ${MAX_KALAMI_BYTES / 1024 / 1024} MB.`] };
  }
  const textContent = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (textContent.startsWith("PK")) {
    return { ok: false, errors: ["This .kalami file is a package from a newer version of Kalami. Update Kalami to open it."] };
  }
  let json: unknown;
  try {
    json = JSON.parse(textContent);
  } catch (error) {
    return { ok: false, errors: [`This isn't a valid .kalami file: the JSON doesn't parse (${(error as Error).message}).`] };
  }
  if (typeof json === "object" && json !== null && (json as { format?: unknown }).format === KALAMI_FORMAT) {
    const version = (json as { version?: unknown }).version;
    if (typeof version === "number" && version > KALAMI_VERSION) {
      return { ok: false, errors: [`This file uses .kalami version ${version}; this Kalami reads version ${KALAMI_VERSION}.`] };
    }
  }
  const result = kalamiFileSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 20).map((issue) => `${where(issue.path)}: ${issue.message}`),
    };
  }
  return { ok: true, file: result.data };
}

/**
 * The part of a file Kalami's signature covers: its kind, who exported it and
 * when, and the whole course, serialised the same way on export and on check.
 * JSON.parse keeps key order, so an unchanged file re-serialises identically.
 */
export function signedPart(file: Pick<KalamiFile, "kind" | "exported" | "course">): string {
  return `kalami-file:v${KALAMI_VERSION}:${JSON.stringify({ kind: file.kind, exported: file.exported, course: file.course })}`;
}

/** A file name for a course: "web-basics.kalami". Georgian titles keep their letters. */
export function kalamiFileName(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "course"}${KALAMI_EXTENSION}`;
}
