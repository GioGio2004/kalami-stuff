import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, type Actor } from "../lib/access";
import { appError } from "../lib/errors";
import { optionalText, requireText } from "../lib/input";
import {
  lessonBlockValidator,
  publishStatusValidator,
  type LessonBlock,
  type LessonBlockInput,
} from "../lib/validators";
import { sceneProblems } from "../lib/scene";
import { logAudit } from "./audit";
import type { Student } from "./learn";
import { keepsPublishedOrder, lessonsOf, requireHttpsUrl, weeksOf } from "./weeks";

/**
 * Lessons written in Kalami: an ordered list of blocks (text, tip/definition
 * boxes, code with an optional live preview, images, video, step-by-step
 * reveals, quick self-checks). Each lesson belongs to a week and has its own
 * draft/published state; students see it when both it and its week are
 * published. Agents can create and edit draft lessons, never published ones.
 */

export const MAX_BLOCKS = 150;
const MAX_LESSONS_PER_WEEK = 30;
/** Keeps a lesson document far below Convex's 1 MiB limit. */
const MAX_LESSON_CHARS = 400_000;

export const CODE_LANGUAGES = [
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
] as const;

// --- Blocks -----------------------------------------------------------------------------

function blockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requireMd(value: string, label: string, max: number): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text === "") {
    throw appError("INVALID_INPUT", `${label} can't be empty.`);
  }
  if (text.length > max) {
    throw appError("INVALID_INPUT", `${label} must be at most ${max} characters.`);
  }
  return text;
}

/** YouTube and Vimeo play inside the lesson; any other https link is shown as a link. */
export function videoEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = parsed.pathname.slice(1);
    else if (host === "youtube.com" && parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (host === "youtube.com" && /^\/(embed|shorts)\//.test(parsed.pathname)) id = parsed.pathname.split("/")[2];
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com" && /^\/\d+$/.test(parsed.pathname)) return `https://player.vimeo.com/video${parsed.pathname}`;
    if (host === "player.vimeo.com" && /^\/video\/\d+$/.test(parsed.pathname)) return parsed.href;
  } catch {
    // Not a URL; the caller already refused it.
  }
  return null;
}

/** Checks one block and gives it an id; everything a lesson stores went through here. */
function normalizeBlock(input: LessonBlockInput, taken: Set<string>, where: string): LessonBlock {
  const id = input.id && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) && !taken.has(input.id) ? input.id : blockId();
  taken.add(id);
  const label = (what: string) => `${where}: ${what}`;
  switch (input.type) {
    case "text":
      return { id, type: "text", md: requireMd(input.md, label("text"), 20_000) };
    case "callout":
      return {
        id,
        type: "callout",
        tone: input.tone,
        title: optionalText(input.title, label("title"), 120),
        md: requireMd(input.md, label("text"), 5_000),
      };
    case "code": {
      const language = input.language.trim().toLowerCase();
      if (!(CODE_LANGUAGES as readonly string[]).includes(language)) {
        throw appError("INVALID_INPUT", `${label("language")} must be one of ${CODE_LANGUAGES.join(", ")}.`);
      }
      const code = input.code.replace(/\r\n/g, "\n");
      if (code.trim() === "" || code.length > 20_000) {
        throw appError("INVALID_INPUT", `${label("code")} must have 1 to 20000 characters.`);
      }
      return {
        id,
        type: "code",
        language,
        code,
        caption: optionalText(input.caption, label("caption"), 300),
        // Only HTML and CSS can be shown running, in the same sandboxed preview as code tasks.
        preview: input.preview === true && (language === "html" || language === "css") ? true : undefined,
      };
    }
    case "image":
      return {
        id,
        type: "image",
        url: requireHttpsUrl(input.url, "image link"),
        // Screen readers read this; an image without it isn't accepted.
        alt: requireText(input.alt, label("image description (alt)"), 300),
        caption: optionalText(input.caption, label("caption"), 300),
      };
    case "video":
      return {
        id,
        type: "video",
        url: requireHttpsUrl(input.url, "video link"),
        caption: optionalText(input.caption, label("caption"), 300),
      };
    case "steps": {
      if (input.steps.length < 1 || input.steps.length > 20) {
        throw appError("INVALID_INPUT", `${label("steps")} must have 1 to 20 steps.`);
      }
      return {
        id,
        type: "steps",
        title: optionalText(input.title, label("title"), 120),
        steps: input.steps.map((step, i) => ({
          title: optionalText(step.title, label(`step ${i + 1} title`), 120),
          md: requireMd(step.md, label(`step ${i + 1}`), 3_000),
        })),
      };
    }
    case "check": {
      const { check } = input;
      const prompt = requireMd(check.prompt, label("question"), 2_000);
      const explanation = optionalText(check.explanation, label("explanation"), 2_000);
      if (check.kind === "short") {
        const accepted = (check.accepted ?? []).map((a) => a.trim()).filter((a) => a !== "");
        if (accepted.length < 1 || accepted.length > 20 || accepted.some((a) => a.length > 200)) {
          throw appError("INVALID_INPUT", `${label("accepted answers")}: give 1 to 20, each up to 200 characters.`);
        }
        return { id, type: "check", check: { kind: "short", prompt, accepted, explanation } };
      }
      const options = (check.options ?? []).map((o) => ({ text: o.text.trim(), correct: o.correct }));
      if (options.length < 2 || options.length > 8 || options.some((o) => o.text === "" || o.text.length > 300)) {
        throw appError("INVALID_INPUT", `${label("options")}: give 2 to 8, each up to 300 characters.`);
      }
      const correct = options.filter((o) => o.correct).length;
      if (check.kind === "single" ? correct !== 1 : correct < 1) {
        throw appError(
          "INVALID_INPUT",
          `${label("options")}: mark ${check.kind === "single" ? "exactly one" : "at least one"} option correct.`,
        );
      }
      return { id, type: "check", check: { kind: check.kind, prompt, options, explanation } };
    }
    case "scene": {
      // The scene's own rules (lib/scene) decide; the first few problems make the message.
      const problems = sceneProblems(input.scene);
      if (problems.length > 0) {
        throw appError("INVALID_INPUT", `${label("scene")}: ${problems.slice(0, 5).join(" ")}`);
      }
      const { scene } = input;
      return {
        id,
        type: "scene",
        scene: {
          title: optionalText(scene.title, label("scene title"), 120),
          theme: scene.theme,
          elements: scene.elements,
          steps: scene.steps,
        },
      };
    }
  }
}

export function normalizeBlocks(inputs: LessonBlockInput[], keep: LessonBlock[] = []): LessonBlock[] {
  const taken = new Set(keep.map((block) => block.id));
  return inputs.map((input, index) => normalizeBlock(input, taken, `Block ${keep.length + index + 1}`));
}

function requireSize(blocks: LessonBlock[]) {
  if (blocks.length > MAX_BLOCKS) {
    throw appError("INVALID_INPUT", `A lesson can have at most ${MAX_BLOCKS} blocks. Split it into two lessons.`);
  }
  if (JSON.stringify(blocks).length > MAX_LESSON_CHARS) {
    throw appError("INVALID_INPUT", "This lesson is too long. Split it into two lessons.");
  }
}

// --- Validators -------------------------------------------------------------------------

export const staffLessonValidator = v.object({
  _id: v.id("lessons"),
  courseId: v.id("courses"),
  courseTitle: v.string(),
  weekId: v.id("weeks"),
  weekTitle: v.string(),
  weekStatus: publishStatusValidator,
  title: v.string(),
  status: publishStatusValidator,
  blocks: v.array(lessonBlockValidator),
  canEdit: v.boolean(),
  createdVia: v.union(v.literal("web"), v.literal("mcp")),
  updatedAt: v.number(),
});

export const studentLessonValidator = v.object({
  _id: v.id("lessons"),
  title: v.string(),
  blocks: v.array(lessonBlockValidator),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  week: v.object({ _id: v.id("weeks"), title: v.string() }),
  /** The lessons before and after this one in the course, for "Next lesson". */
  previous: v.union(v.null(), v.object({ _id: v.id("lessons"), title: v.string() })),
  next: v.union(v.null(), v.object({ _id: v.id("lessons"), title: v.string() })),
});

// --- Staff ------------------------------------------------------------------------------

/** The lesson, if the actor may change it. Agents only touch draft lessons. */
async function requireLesson(ctx: QueryCtx, actor: Actor, lessonId: Id<"lessons">) {
  const lesson = await ctx.db.get("lessons", lessonId);
  if (lesson === null) {
    throw appError("NOT_FOUND", "Lesson not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, lesson.courseId);
  if (actor.via === "mcp" && lesson.status !== "draft") {
    throw appError(
      "CONFLICT",
      `"${lesson.title}" is published, so only the lecturer can change it. Ask them to move it back to draft first.`,
    );
  }
  return { lesson, course };
}

export async function getLesson(ctx: QueryCtx, actor: Actor, lessonId: Id<"lessons">) {
  const lesson = await ctx.db.get("lessons", lessonId);
  if (lesson === null) {
    throw appError("NOT_FOUND", "Lesson not found.");
  }
  const access = await courseAccess(ctx, actor, lesson.courseId);
  const week = await ctx.db.get("weeks", lesson.weekId);
  return {
    _id: lesson._id,
    courseId: lesson.courseId,
    courseTitle: access.course.title,
    weekId: lesson.weekId,
    weekTitle: week?.title ?? "",
    weekStatus: week?.status ?? ("draft" as const),
    title: lesson.title,
    status: lesson.status,
    blocks: lesson.blocks,
    canEdit: access.canEdit && access.course.status !== "archived",
    createdVia: lesson.createdVia,
    updatedAt: lesson.updatedAt,
  };
}

export async function createLesson(
  ctx: MutationCtx,
  actor: Actor,
  args: { weekId: Id<"weeks">; title: string; blocks?: LessonBlockInput[] },
): Promise<Id<"lessons">> {
  const week = await ctx.db.get("weeks", args.weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, week.courseId);
  const lessons = await lessonsOf(ctx, args.weekId);
  if (lessons.length >= MAX_LESSONS_PER_WEEK) {
    throw appError("CONFLICT", `A week can have at most ${MAX_LESSONS_PER_WEEK} lessons.`);
  }
  const title = requireText(args.title, "Title", 160);
  const blocks = normalizeBlocks(args.blocks ?? []);
  requireSize(blocks);
  const lessonId = await ctx.db.insert("lessons", {
    courseId: week.courseId,
    weekId: args.weekId,
    order: lessons.length === 0 ? 1 : lessons[lessons.length - 1].order + 1,
    title,
    status: "draft",
    blocks,
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: Date.now(),
  });
  await logAudit(ctx, actor, {
    action: "lesson.create",
    targetTable: "lessons",
    targetId: lessonId,
    courseId: week.courseId,
    summary: `Drafted the lesson "${title}" in "${week.title}" of "${course.title}"`,
  });
  return lessonId;
}

export async function updateLesson(ctx: MutationCtx, actor: Actor, lessonId: Id<"lessons">, patch: { title?: string }) {
  await requireLesson(ctx, actor, lessonId);
  const changes: Partial<Doc<"lessons">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", 160);
  await ctx.db.patch("lessons", lessonId, { ...changes, updatedAt: Date.now() });
}

/** Replaces every block (the editor saves the whole lesson; agents may rewrite it). */
export async function setBlocks(ctx: MutationCtx, actor: Actor, lessonId: Id<"lessons">, inputs: LessonBlockInput[]) {
  await requireLesson(ctx, actor, lessonId);
  const blocks = normalizeBlocks(inputs);
  requireSize(blocks);
  await ctx.db.patch("lessons", lessonId, { blocks, updatedAt: Date.now() });
  return blocks.map((block) => block.id);
}

/** Inserts blocks at `position` (0-based; default: the end). Returns the new block ids. */
export async function addBlocks(
  ctx: MutationCtx,
  actor: Actor,
  lessonId: Id<"lessons">,
  inputs: LessonBlockInput[],
  position?: number,
) {
  const { lesson } = await requireLesson(ctx, actor, lessonId);
  const added = normalizeBlocks(inputs, lesson.blocks);
  const at = position === undefined ? lesson.blocks.length : Math.max(0, Math.min(position, lesson.blocks.length));
  const blocks = [...lesson.blocks.slice(0, at), ...added, ...lesson.blocks.slice(at)];
  requireSize(blocks);
  await ctx.db.patch("lessons", lessonId, { blocks, updatedAt: Date.now() });
  return added.map((block) => block.id);
}

export async function updateBlock(
  ctx: MutationCtx,
  actor: Actor,
  lessonId: Id<"lessons">,
  blockIdToChange: string,
  input: LessonBlockInput,
) {
  const { lesson } = await requireLesson(ctx, actor, lessonId);
  const index = lesson.blocks.findIndex((block) => block.id === blockIdToChange);
  if (index < 0) {
    throw appError("NOT_FOUND", "Block not found.");
  }
  const others = lesson.blocks.filter((_, i) => i !== index);
  const [fresh] = normalizeBlocks([{ ...input, id: blockIdToChange }], others);
  const blocks = lesson.blocks.map((block, i) => (i === index ? fresh : block));
  requireSize(blocks);
  await ctx.db.patch("lessons", lessonId, { blocks, updatedAt: Date.now() });
}

export async function deleteBlock(ctx: MutationCtx, actor: Actor, lessonId: Id<"lessons">, blockIdToDelete: string) {
  const { lesson } = await requireLesson(ctx, actor, lessonId);
  await ctx.db.patch("lessons", lessonId, {
    blocks: lesson.blocks.filter((block) => block.id !== blockIdToDelete),
    updatedAt: Date.now(),
  });
}

/** Moves a lesson up or down within its week, or into another week of the course (appended). */
export async function moveLesson(
  ctx: MutationCtx,
  actor: Actor,
  lessonId: Id<"lessons">,
  to: { direction: "up" | "down" } | { weekId: Id<"weeks"> },
) {
  const { lesson } = await requireLesson(ctx, actor, lessonId);
  if ("weekId" in to) {
    const week = await ctx.db.get("weeks", to.weekId);
    if (week === null || week.courseId !== lesson.courseId) {
      throw appError("NOT_FOUND", "Week not found in this course.");
    }
    if (week._id === lesson.weekId) return;
    const there = await lessonsOf(ctx, week._id);
    await ctx.db.patch("lessons", lessonId, {
      weekId: week._id,
      order: there.length === 0 ? 1 : there[there.length - 1].order + 1,
      updatedAt: Date.now(),
    });
    return;
  }
  const siblings = await lessonsOf(ctx, lesson.weekId);
  const index = siblings.findIndex((l) => l._id === lessonId);
  const other = siblings[to.direction === "up" ? index - 1 : index + 1];
  if (other === undefined) return;
  await ctx.db.patch("lessons", lesson._id, { order: other.order });
  await ctx.db.patch("lessons", other._id, { order: lesson.order });
}

/**
 * Puts a week's lessons in this order (every lesson of the week once). Agents
 * may move drafts anywhere, as long as published lessons keep their order.
 */
export async function reorderLessons(ctx: MutationCtx, actor: Actor, weekId: Id<"weeks">, lessonIds: Id<"lessons">[]) {
  const week = await ctx.db.get("weeks", weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  await requireCourseContentEditor(ctx, actor, week.courseId);
  const lessons = await lessonsOf(ctx, weekId);
  const known = new Set(lessons.map((lesson) => lesson._id));
  if (
    lessonIds.length !== lessons.length ||
    new Set(lessonIds).size !== lessonIds.length ||
    lessonIds.some((id) => !known.has(id))
  ) {
    throw appError("INVALID_INPUT", "List every lesson of the week exactly once.");
  }
  if (actor.via === "mcp") {
    keepsPublishedOrder(lessons, lessonIds, "lessons");
  }
  for (const [index, id] of lessonIds.entries()) {
    const lesson = lessons.find((l) => l._id === id)!;
    if (lesson.order !== index + 1) {
      await ctx.db.patch("lessons", id, { order: index + 1 });
    }
  }
}

export async function setLessonStatus(
  ctx: MutationCtx,
  actor: Actor,
  lessonId: Id<"lessons">,
  status: "draft" | "published",
) {
  if (actor.via === "mcp") {
    throw appError("FORBIDDEN", "Only the lecturer can publish or unpublish a lesson, in the Kalami dashboard.");
  }
  const { lesson, course } = await requireLesson(ctx, actor, lessonId);
  if (status === "published" && lesson.blocks.length === 0) {
    throw appError("CONFLICT", "Add something to the lesson before publishing it.");
  }
  const now = Date.now();
  await ctx.db.patch("lessons", lessonId, {
    status,
    publishedAt: status === "published" ? (lesson.publishedAt ?? now) : lesson.publishedAt,
    updatedAt: now,
  });
  await logAudit(ctx, actor, {
    action: status === "published" ? "lesson.publish" : "lesson.unpublish",
    targetTable: "lessons",
    targetId: lessonId,
    courseId: lesson.courseId,
    summary: `${status === "published" ? "Published" : "Hid"} the lesson "${lesson.title}" in "${course.title}"`,
  });
}

export async function deleteLesson(ctx: MutationCtx, actor: Actor, lessonId: Id<"lessons">) {
  const { lesson, course } = await requireLesson(ctx, actor, lessonId);
  await ctx.db.delete("lessons", lessonId);
  await logAudit(ctx, actor, {
    action: "lesson.delete",
    targetTable: "lessons",
    targetId: lessonId,
    courseId: lesson.courseId,
    summary: `Deleted the lesson "${lesson.title}" from "${course.title}"`,
  });
}

// --- Students ---------------------------------------------------------------------------

/**
 * A lesson for a student of its course: the course must be visible, the
 * student enrolled, and both the week and the lesson published. Anything else
 * is NOT_FOUND, so drafts can't be probed.
 */
export async function getStudentLesson(ctx: QueryCtx, student: Student, lessonId: Id<"lessons">) {
  const lesson = await ctx.db.get("lessons", lessonId);
  const course = lesson === null ? null : await ctx.db.get("courses", lesson.courseId);
  const week = lesson === null ? null : await ctx.db.get("weeks", lesson.weekId);
  const enrollment =
    course === null
      ? null
      : await ctx.db
          .query("enrollments")
          .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", course._id).eq("userId", student.user._id))
          .unique();
  if (
    lesson === null ||
    course === null ||
    week === null ||
    course.status === "draft" ||
    enrollment?.status !== "active" ||
    week.status !== "published" ||
    lesson.status !== "published"
  ) {
    throw appError("NOT_FOUND", "Lesson not found.");
  }
  // Every visible lesson of the course, in outline order, for previous/next.
  const visible: { _id: Id<"lessons">; title: string }[] = [];
  for (const w of await weeksOf(ctx, course._id)) {
    if (w.status !== "published") continue;
    for (const l of await lessonsOf(ctx, w._id)) {
      if (l.status === "published") visible.push({ _id: l._id, title: l.title });
    }
  }
  const index = visible.findIndex((l) => l._id === lessonId);
  return {
    _id: lesson._id,
    title: lesson.title,
    blocks: lesson.blocks,
    course: { _id: course._id, title: course.title },
    week: { _id: week._id, title: week.title },
    previous: index > 0 ? visible[index - 1] : null,
    next: index >= 0 && index < visible.length - 1 ? visible[index + 1] : null,
  };
}
