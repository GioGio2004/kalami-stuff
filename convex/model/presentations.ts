import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, type Actor } from "../lib/access";
import { appError } from "../lib/errors";
import { requireText } from "../lib/input";
import { DECK_LIMITS, DEFAULT_THEME, deckProblems, SLIDE_ID_PATTERN, tidySlide, type DeckTheme, type Slide } from "../lib/presentation";
import {
  deckThemeValidator,
  publishStatusValidator,
  slideValidator,
  type SlideDoc,
  type SlideInput,
} from "../lib/validators";
import { logAudit } from "./audit";
import type { Student } from "./learn";

/**
 * Presentations: decks of typed slides in a curated theme, inside a week next
 * to its lessons. The vocabulary and every rule live in lib/presentation (the
 * player and the editor use the same code), so a deck is checked once here
 * and trusted everywhere after. Each presentation has its own draft/published
 * state; students see it when both it and its week are published. Agents can
 * create and change drafts, never published ones, and never publish.
 */

const MAX_PRESENTATIONS_PER_WEEK = 20;
/** Keeps a presentation document far below Convex's 1 MiB limit. */
const MAX_DECK_CHARS = 300_000;

// The validators' slide and the rules' slide are the same shape; these lines stop them drifting apart.
const asSlide = (slide: SlideDoc): Slide => slide;
const asDoc = (slide: Slide): SlideDoc => slide;
void asDoc;

export async function presentationsOf(ctx: QueryCtx, weekId: Id<"weeks">) {
  return await ctx.db
    .query("presentations")
    .withIndex("by_weekId_and_order", (q) => q.eq("weekId", weekId))
    .take(MAX_PRESENTATIONS_PER_WEEK + 1);
}

function slideId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tidies and checks a whole deck, giving new slides an id and keeping the ids
 * slides came with (the editor and agents use them). Every problem the deck
 * has is reported at once, with where it is.
 */
export function normalizeSlides(inputs: SlideInput[], theme: DeckTheme): SlideDoc[] {
  const taken = new Set<string>();
  const slides = inputs.map((input) => {
    const id = input.id && SLIDE_ID_PATTERN.test(input.id) && !taken.has(input.id) ? input.id : slideId();
    taken.add(id);
    return tidySlide(asSlide({ ...input, id } as SlideDoc));
  });
  const problems = deckProblems({ theme, slides });
  if (problems.length > 0) {
    const shown = problems.slice(0, 8).join(" ");
    const more = problems.length > 8 ? ` (and ${problems.length - 8} more)` : "";
    throw appError("INVALID_INPUT", `This presentation can't be saved yet: ${shown}${more}`);
  }
  if (JSON.stringify(slides).length > MAX_DECK_CHARS) {
    throw appError("INVALID_INPUT", "This presentation is too long. Split it into two presentations.");
  }
  return slides;
}

// --- Validators -------------------------------------------------------------------------

export const staffPresentationValidator = v.object({
  _id: v.id("presentations"),
  courseId: v.id("courses"),
  courseTitle: v.string(),
  weekId: v.id("weeks"),
  weekTitle: v.string(),
  weekStatus: publishStatusValidator,
  title: v.string(),
  theme: deckThemeValidator,
  slides: v.array(slideValidator),
  status: publishStatusValidator,
  canEdit: v.boolean(),
  createdVia: v.union(v.literal("web"), v.literal("mcp")),
  updatedAt: v.number(),
});

export const studentPresentationValidator = v.object({
  _id: v.id("presentations"),
  title: v.string(),
  theme: deckThemeValidator,
  slides: v.array(slideValidator),
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  week: v.object({ _id: v.id("weeks"), title: v.string() }),
});

// --- Staff ------------------------------------------------------------------------------

/** The presentation, if the actor may change it. Agents only touch drafts. */
async function requirePresentation(ctx: QueryCtx, actor: Actor, presentationId: Id<"presentations">) {
  const deck = await ctx.db.get("presentations", presentationId);
  if (deck === null) {
    throw appError("NOT_FOUND", "Presentation not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, deck.courseId);
  if (actor.via === "mcp" && deck.status !== "draft") {
    throw appError(
      "CONFLICT",
      `"${deck.title}" is published, so only the lecturer can change it. Ask them to move it back to draft first.`,
    );
  }
  return { deck, course };
}

export async function getPresentation(ctx: QueryCtx, actor: Actor, presentationId: Id<"presentations">) {
  const deck = await ctx.db.get("presentations", presentationId);
  if (deck === null) {
    throw appError("NOT_FOUND", "Presentation not found.");
  }
  const access = await courseAccess(ctx, actor, deck.courseId);
  const week = await ctx.db.get("weeks", deck.weekId);
  return {
    _id: deck._id,
    courseId: deck.courseId,
    courseTitle: access.course.title,
    weekId: deck.weekId,
    weekTitle: week?.title ?? "",
    weekStatus: week?.status ?? ("draft" as const),
    title: deck.title,
    theme: deck.theme,
    slides: deck.slides,
    status: deck.status,
    canEdit: access.canEdit && access.course.status !== "archived",
    createdVia: deck.createdVia,
    updatedAt: deck.updatedAt,
  };
}

export async function createPresentation(
  ctx: MutationCtx,
  actor: Actor,
  args: { weekId: Id<"weeks">; title: string; theme?: DeckTheme; slides?: SlideInput[] },
): Promise<Id<"presentations">> {
  const week = await ctx.db.get("weeks", args.weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  const { course } = await requireCourseContentEditor(ctx, actor, week.courseId);
  const existing = await presentationsOf(ctx, args.weekId);
  if (existing.length >= MAX_PRESENTATIONS_PER_WEEK) {
    throw appError("CONFLICT", `A week can have at most ${MAX_PRESENTATIONS_PER_WEEK} presentations.`);
  }
  const title = requireText(args.title, "Title", DECK_LIMITS.deckTitle);
  const theme = args.theme ?? DEFAULT_THEME;
  // A new presentation from the editor starts as one title slide; agents send the whole deck.
  const slides = normalizeSlides(args.slides && args.slides.length > 0 ? args.slides : [{ type: "title", title }], theme);
  const presentationId = await ctx.db.insert("presentations", {
    courseId: week.courseId,
    weekId: args.weekId,
    order: existing.length === 0 ? 1 : existing[existing.length - 1].order + 1,
    title,
    theme,
    slides,
    status: "draft",
    createdBy: actor.user._id,
    createdVia: actor.via,
    updatedAt: Date.now(),
  });
  await logAudit(ctx, actor, {
    action: "presentation.create",
    targetTable: "presentations",
    targetId: presentationId,
    courseId: week.courseId,
    summary: `Drafted the presentation "${title}" (${slides.length} slides) in "${week.title}" of "${course.title}"`,
  });
  return presentationId;
}

/**
 * Saves what changed: the title, the theme and/or every slide (the editor
 * saves the whole deck; agents may rewrite it). Returns the slides' ids.
 */
export async function savePresentation(
  ctx: MutationCtx,
  actor: Actor,
  presentationId: Id<"presentations">,
  patch: { title?: string; theme?: DeckTheme; slides?: SlideInput[] },
): Promise<string[]> {
  const { deck } = await requirePresentation(ctx, actor, presentationId);
  const changes: Partial<Doc<"presentations">> = {};
  if (patch.title !== undefined) changes.title = requireText(patch.title, "Title", DECK_LIMITS.deckTitle);
  const theme = patch.theme ?? deck.theme;
  if (patch.theme !== undefined) changes.theme = patch.theme;
  if (patch.slides !== undefined) {
    if (patch.slides.length === 0) {
      throw appError("INVALID_INPUT", "A presentation needs at least one slide.");
    }
    changes.slides = normalizeSlides(patch.slides, theme);
  }
  await ctx.db.patch("presentations", presentationId, { ...changes, updatedAt: Date.now() });
  return (changes.slides ?? deck.slides).map((slide) => slide.id);
}

export async function setPresentationStatus(
  ctx: MutationCtx,
  actor: Actor,
  presentationId: Id<"presentations">,
  status: "draft" | "published",
) {
  if (actor.via === "mcp") {
    throw appError("FORBIDDEN", "Only the lecturer can publish or unpublish a presentation, in the Kalami dashboard.");
  }
  const { deck, course } = await requirePresentation(ctx, actor, presentationId);
  const now = Date.now();
  await ctx.db.patch("presentations", presentationId, {
    status,
    publishedAt: status === "published" ? (deck.publishedAt ?? now) : deck.publishedAt,
    updatedAt: now,
  });
  await logAudit(ctx, actor, {
    action: status === "published" ? "presentation.publish" : "presentation.unpublish",
    targetTable: "presentations",
    targetId: presentationId,
    courseId: deck.courseId,
    summary: `${status === "published" ? "Published" : "Hid"} the presentation "${deck.title}" in "${course.title}"`,
  });
}

export async function deletePresentation(ctx: MutationCtx, actor: Actor, presentationId: Id<"presentations">) {
  const { deck, course } = await requirePresentation(ctx, actor, presentationId);
  await ctx.db.delete("presentations", presentationId);
  await logAudit(ctx, actor, {
    action: "presentation.delete",
    targetTable: "presentations",
    targetId: presentationId,
    courseId: deck.courseId,
    summary: `Deleted the presentation "${deck.title}" from "${course.title}"`,
  });
}

// --- Students ---------------------------------------------------------------------------

/**
 * A presentation for a student of its course: the course must be visible, the
 * student enrolled, and both the week and the presentation published.
 * Anything else is NOT_FOUND, so drafts can't be probed.
 */
export async function getStudentPresentation(ctx: QueryCtx, student: Student, presentationId: Id<"presentations">) {
  const deck = await ctx.db.get("presentations", presentationId);
  const course = deck === null ? null : await ctx.db.get("courses", deck.courseId);
  const week = deck === null ? null : await ctx.db.get("weeks", deck.weekId);
  const enrollment =
    course === null
      ? null
      : await ctx.db
          .query("enrollments")
          .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", course._id).eq("userId", student.user._id))
          .unique();
  if (
    deck === null ||
    course === null ||
    week === null ||
    course.status === "draft" ||
    enrollment?.status !== "active" ||
    week.status !== "published" ||
    deck.status !== "published"
  ) {
    throw appError("NOT_FOUND", "Presentation not found.");
  }
  return {
    _id: deck._id,
    title: deck.title,
    theme: deck.theme,
    slides: deck.slides,
    course: { _id: course._id, title: course.title },
    week: { _id: week._id, title: week.title },
  };
}
