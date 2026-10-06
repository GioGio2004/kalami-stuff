import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { courseAccess, requireCourseContentEditor, requireCourseEditor, type Actor } from "../lib/access";
import { appError } from "../lib/errors";
import { requireText } from "../lib/input";
import { DECK_LIMITS, DEFAULT_THEME, deckProblems, SLIDE_ID_PATTERN, tidySlide, type DeckTheme, type Slide } from "../lib/presentation";
import { generateLinkToken } from "../lib/tokens";
import {
  deckThemeValidator,
  publishStatusValidator,
  slideValidator,
  type SlideDoc,
  type SlideInput,
} from "../lib/validators";
import { displayName, lecturerName, logAudit } from "./audit";
import type { Student } from "./learn";
import { keepsPublishedOrder, presentationsOf } from "./weeks";

/**
 * Presentations: decks of typed slides in a curated theme, inside a week next
 * to its lessons. The vocabulary and every rule live in lib/presentation (the
 * player and the editor use the same code), so a deck is checked once here
 * and trusted everywhere after. Each presentation has its own draft/published
 * state; students see it when both it and its week are published. Agents can
 * create and change drafts, never published ones, and never publish or share.
 */

const MAX_PRESENTATIONS_PER_WEEK = 20;
/** Keeps a presentation document far below Convex's 1 MiB limit. */
const MAX_DECK_CHARS = 300_000;

// The validators' slide and the rules' slide are the same shape; these lines stop them drifting apart.
const asSlide = (slide: SlideDoc): Slide => slide;
const asDoc = (slide: Slide): SlideDoc => slide;
void asDoc;

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

/** Its public link as staff see it (see Share links below). `by`: who made the current link. */
const staffShareValidator = v.union(
  v.null(),
  v.object({ token: v.string(), notes: v.boolean(), by: v.string(), at: v.number() }),
);

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
  /** May turn its link on or off: the course's editors, archived courses included; never agents. */
  canShare: v.boolean(),
  share: staffShareValidator,
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
  const share = deck.share;
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
    canShare: access.canEdit && actor.via !== "mcp",
    share:
      share === undefined
        ? null
        : { token: share.token, notes: share.notes, by: displayName(await ctx.db.get("users", share.by)), at: share.at },
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

/**
 * Moves a presentation up or down within its week, or into another week of the
 * same course (to the end). Agents only move drafts (requirePresentation).
 */
export async function movePresentation(
  ctx: MutationCtx,
  actor: Actor,
  presentationId: Id<"presentations">,
  to: { direction: "up" | "down" } | { weekId: Id<"weeks"> },
) {
  const { deck, course } = await requirePresentation(ctx, actor, presentationId);
  if ("weekId" in to) {
    const week = await ctx.db.get("weeks", to.weekId);
    if (week === null || week.courseId !== deck.courseId) {
      throw appError("NOT_FOUND", "Week not found in this course.");
    }
    if (week._id === deck.weekId) return;
    const there = await presentationsOf(ctx, week._id);
    if (there.length >= MAX_PRESENTATIONS_PER_WEEK) {
      throw appError("CONFLICT", `“${week.title}” already has ${MAX_PRESENTATIONS_PER_WEEK} presentations, the most a week can hold.`);
    }
    await ctx.db.patch("presentations", presentationId, {
      weekId: week._id,
      order: there.length === 0 ? 1 : there[there.length - 1].order + 1,
      updatedAt: Date.now(),
    });
    await logAudit(ctx, actor, {
      action: "presentation.move",
      targetTable: "presentations",
      targetId: presentationId,
      courseId: deck.courseId,
      summary: `Moved the presentation "${deck.title}" to "${week.title}" in "${course.title}"`,
    });
    return;
  }
  const siblings = await presentationsOf(ctx, deck.weekId);
  const index = siblings.findIndex((p) => p._id === presentationId);
  const other = siblings[to.direction === "up" ? index - 1 : index + 1];
  if (other === undefined) return;
  // Agents may only swap drafts; a published neighbour keeps its place for students.
  if (actor.via === "mcp" && other.status !== "draft") {
    throw appError("CONFLICT", `"${other.title}" is published, so only the lecturer can move presentations around it.`);
  }
  await ctx.db.patch("presentations", deck._id, { order: other.order });
  await ctx.db.patch("presentations", other._id, { order: deck.order });
}

/**
 * Puts a week's presentations in this order (every one of the week once).
 * Agents may move drafts anywhere, as long as published ones keep their order.
 */
export async function reorderPresentations(
  ctx: MutationCtx,
  actor: Actor,
  weekId: Id<"weeks">,
  presentationIds: Id<"presentations">[],
) {
  const week = await ctx.db.get("weeks", weekId);
  if (week === null) {
    throw appError("NOT_FOUND", "Week not found.");
  }
  await requireCourseContentEditor(ctx, actor, week.courseId);
  const decks = await presentationsOf(ctx, weekId);
  const known = new Set(decks.map((deck) => deck._id));
  if (
    presentationIds.length !== decks.length ||
    new Set(presentationIds).size !== presentationIds.length ||
    presentationIds.some((id) => !known.has(id))
  ) {
    throw appError("INVALID_INPUT", "List every presentation of the week exactly once.");
  }
  if (actor.via === "mcp") {
    keepsPublishedOrder(decks, presentationIds, "presentations");
  }
  for (const [index, id] of presentationIds.entries()) {
    const deck = decks.find((d) => d._id === id)!;
    if (deck.order !== index + 1) {
      await ctx.db.patch("presentations", id, { order: index + 1 });
    }
  }
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

// --- Share links ------------------------------------------------------------------------
//
// A presentation can have one public link. Anyone who has it watches the deck
// on the student app's /p/<token>, no account needed: the saved slides and
// nothing else of the course. The course's owner (or an admin) turns it on in
// the editor, decides whether the speaker notes go along, makes a new link
// (the old one stops working at once) or stops sharing. Drafts and archived
// courses can be shared too; it's the lecturer's call, like publishing, so
// agents see the link but never turn it on or off.

/** Links are made 20 URL-safe characters long (lib/tokens); nothing else is ever looked up. */
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

async function uniqueShareToken(ctx: QueryCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const token = generateLinkToken();
    const taken = await ctx.db
      .query("presentations")
      .withIndex("by_shareToken", (q) => q.eq("share.token", token))
      .unique();
    if (taken === null) {
      return token;
    }
  }
  throw appError("CONFLICT", "Couldn't make a link just now. Try again.");
}

/** The presentation, if the actor may manage its link. */
async function requireSharer(ctx: QueryCtx, actor: Actor, presentationId: Id<"presentations">) {
  if (actor.via === "mcp") {
    throw appError("FORBIDDEN", "Only the lecturer can share a presentation's link, with Share in its editor.");
  }
  const deck = await ctx.db.get("presentations", presentationId);
  if (deck === null) {
    throw appError("NOT_FOUND", "Presentation not found.");
  }
  // Not requireCourseContentEditor: an archived course's decks can still be shared, and unshared.
  const { course } = await requireCourseEditor(ctx, actor, deck.courseId);
  return { deck, course };
}

/**
 * Turns the link on, or keeps the one it has, with these settings; returns
 * its token. `newLink` replaces it: the old link stops working at once.
 */
export async function sharePresentation(
  ctx: MutationCtx,
  actor: Actor,
  presentationId: Id<"presentations">,
  options: { notes: boolean; newLink?: boolean },
): Promise<string> {
  const { deck, course } = await requireSharer(ctx, actor, presentationId);
  const current = deck.share;
  let share: NonNullable<Doc<"presentations">["share"]>;
  let action: string;
  let summary: string;
  if (current === undefined || options.newLink === true) {
    share = { token: await uniqueShareToken(ctx), notes: options.notes, by: actor.user._id, at: Date.now() };
    action = current === undefined ? "presentation.share" : "presentation.shareLink";
    summary =
      current === undefined
        ? `Shared a link to the presentation "${deck.title}" in "${course.title}"`
        : `Made a new link to the presentation "${deck.title}" in "${course.title}"; the old one stopped working`;
  } else if (current.notes !== options.notes) {
    share = { ...current, notes: options.notes };
    action = "presentation.shareNotes";
    summary = `${options.notes ? "Added" : "Took"} the speaker notes ${options.notes ? "to" : "off"} the link to "${deck.title}" in "${course.title}"`;
  } else {
    return current.token;
  }
  await ctx.db.patch("presentations", presentationId, { share });
  await logAudit(ctx, actor, { action, targetTable: "presentations", targetId: presentationId, courseId: deck.courseId, summary });
  return share.token;
}

/** Turns the link off: it stops working at once. Sharing again makes a new one. */
export async function stopSharingPresentation(ctx: MutationCtx, actor: Actor, presentationId: Id<"presentations">) {
  const { deck, course } = await requireSharer(ctx, actor, presentationId);
  if (deck.share === undefined) {
    return;
  }
  await ctx.db.patch("presentations", presentationId, { share: undefined });
  await logAudit(ctx, actor, {
    action: "presentation.unshare",
    targetTable: "presentations",
    targetId: presentationId,
    courseId: deck.courseId,
    summary: `Stopped sharing the link to the presentation "${deck.title}" in "${course.title}"`,
  });
}

export const sharedPresentationValidator = v.object({
  title: v.string(),
  theme: deckThemeValidator,
  slides: v.array(slideValidator),
  /** Whether the lecturer shares the speaker notes; the slides only carry them then. */
  notes: v.boolean(),
  /** Who shared it, as students see lecturers: a name, never an email. */
  sharedBy: v.string(),
});

/**
 * A presentation by its link, for anyone who has it, signed in or not. Null
 * when there is no such link (there never was, or it was turned off or
 * replaced), so a dead link gives nothing away. Only the deck goes out: no
 * course, no week, no ids, and speaker notes only when the lecturer chose.
 */
export async function getSharedPresentation(ctx: QueryCtx, rawToken: string) {
  const token = rawToken.trim();
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    return null;
  }
  const deck = await ctx.db
    .query("presentations")
    .withIndex("by_shareToken", (q) => q.eq("share.token", token))
    .unique();
  if (deck === null || deck.share === undefined) {
    return null;
  }
  return {
    title: deck.title,
    theme: deck.theme,
    slides: deck.share.notes ? deck.slides : deck.slides.map(withoutNotes),
    notes: deck.share.notes,
    sharedBy: lecturerName(await ctx.db.get("users", deck.share.by)),
  };
}

function withoutNotes(slide: SlideDoc): SlideDoc {
  const copy = { ...slide };
  delete copy.notes;
  return copy;
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
