import { v, type Infer, type ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireCourseContentEditor, requireStaffActor, requireTokenActor, type Actor } from "../lib/access";
import { appError } from "../lib/errors";
import { enforceLimit } from "../lib/limits";
import { checkImageLink, linkKey } from "../lib/media/link";
import type { SlideDoc } from "../lib/validators";

/**
 * Pictures copied into Kalami (the `media` table). mediaActions.ts does the
 * work that needs Node (fetching, compressing, ImageKit); this module decides
 * who may, which course a picture belongs to, when an earlier copy can be
 * reused, and which picture links a presentation may keep.
 */

/** What copying a picture in gives back: where it is now and what it weighs. */
export const mediaResultValidator = v.object({
  url: v.string(),
  width: v.number(),
  height: v.number(),
  bytes: v.number(),
  originalBytes: v.number(),
  /** An earlier copy of the same picture in this course was used. */
  reused: v.boolean(),
});
export type MediaResult = Infer<typeof mediaResultValidator>;

/** Who asks: the signed-in staff member, or an agent with its credential. */
export const mediaCallerValidator = v.union(
  v.object({ kind: v.literal("web") }),
  v.object({ kind: v.literal("agent"), token: v.string(), client: v.optional(v.string()) }),
);
type MediaCaller = Infer<typeof mediaCallerValidator>;

/** The course a picture is for: by its id, or through a week or a presentation (agents saving a deck). */
export const mediaTargetValidator = v.union(
  v.object({ courseId: v.id("courses") }),
  v.object({ weekId: v.id("weeks") }),
  v.object({ presentationId: v.id("presentations") }),
);
type MediaTarget = Infer<typeof mediaTargetValidator>;

export const mediaSourceValidator = v.union(
  v.object({ kind: v.literal("upload"), name: v.optional(v.string()) }),
  v.object({ kind: v.literal("link"), url: v.string() }),
);

function asResult(row: Doc<"media">, reused: boolean): MediaResult {
  return { url: row.url, width: row.width, height: row.height, bytes: row.bytes, originalBytes: row.originalBytes, reused };
}

async function actorOf(ctx: QueryCtx, caller: MediaCaller): Promise<Actor> {
  return caller.kind === "web" ? await requireStaffActor(ctx) : await requireTokenActor(ctx, caller.token, caller.client);
}

async function courseOf(ctx: QueryCtx, target: MediaTarget): Promise<Id<"courses">> {
  if ("courseId" in target) return target.courseId;
  const row = "weekId" in target ? await ctx.db.get("weeks", target.weekId) : await ctx.db.get("presentations", target.presentationId);
  if (row === null) {
    throw appError("NOT_FOUND", "weekId" in target ? "Week not found." : "Presentation not found.");
  }
  return row.courseId;
}

/**
 * A Kalami picture this course may show: its own row, or (a picture another
 * course has, e.g. a deck imported from a file) a row of its own for the same
 * file, so deleting the other course keeps the file. Null for any other link.
 */
async function claimKalamiPicture(
  ctx: MutationCtx,
  courseId: Id<"courses">,
  url: string,
  by: { ownerId: Id<"users">; via: Doc<"media">["via"] },
): Promise<Doc<"media"> | null> {
  const own = await ctx.db
    .query("media")
    .withIndex("by_courseId_and_url", (q) => q.eq("courseId", courseId).eq("url", url))
    .first();
  if (own !== null) return own;
  const elsewhere = await ctx.db
    .query("media")
    .withIndex("by_url", (q) => q.eq("url", url))
    .first();
  if (elsewhere === null) return null;
  const { fileId, width, height, bytes, originalBytes } = elsewhere;
  const id = await ctx.db.insert("media", {
    courseId,
    ownerId: by.ownerId,
    via: by.via,
    fileId,
    url,
    width,
    height,
    bytes,
    originalBytes,
    source: { kind: "copy" },
  });
  return (await ctx.db.get("media", id))!;
}

export type MediaStart =
  | { kind: "reuse"; result: MediaResult }
  | { kind: "new"; courseId: Id<"courses">; ownerId: Id<"users">; via: Doc<"media">["via"]; sourceKey?: string };

/**
 * Before any download or upload: the caller must be able to edit the course.
 * A link that is already a Kalami picture, or one this course copied in
 * before, is reused at no cost; anything new counts against the `media` limit.
 */
export async function startMedia(
  ctx: MutationCtx,
  caller: MediaCaller,
  target: MediaTarget,
  link: string | undefined,
): Promise<MediaStart> {
  const actor = await actorOf(ctx, caller);
  const courseId = await courseOf(ctx, target);
  await requireCourseContentEditor(ctx, actor, courseId);
  const by = { ownerId: actor.user._id, via: actor.via };
  let sourceKey: string | undefined;
  if (link !== undefined) {
    const kalami = await claimKalamiPicture(ctx, courseId, link.trim(), by);
    if (kalami !== null) return { kind: "reuse", result: asResult(kalami, true) };
    const check = checkImageLink(link);
    if (!check.ok) throw appError("INVALID_INPUT", check.reason);
    sourceKey = linkKey(check.url);
    const earlier = await ctx.db
      .query("media")
      .withIndex("by_courseId_and_sourceKey", (q) => q.eq("courseId", courseId).eq("sourceKey", sourceKey))
      .first();
    if (earlier !== null) return { kind: "reuse", result: asResult(earlier, true) };
  }
  await enforceLimit(ctx, "media", actor.user._id);
  return { kind: "new", courseId, ownerId: by.ownerId, via: by.via, sourceKey };
}

export const recordMediaArgs = {
  courseId: v.id("courses"),
  ownerId: v.id("users"),
  via: v.union(v.literal("web"), v.literal("mcp")),
  fileId: v.string(),
  url: v.string(),
  width: v.number(),
  height: v.number(),
  bytes: v.number(),
  originalBytes: v.number(),
  source: mediaSourceValidator,
  sourceKey: v.optional(v.string()),
};

export async function recordMedia(ctx: MutationCtx, args: ObjectType<typeof recordMediaArgs>): Promise<MediaResult> {
  const id = await ctx.db.insert("media", args);
  return asResult((await ctx.db.get("media", id))!, false);
}

/**
 * The picture links a deck being saved may have. Kalami pictures are fine
 * (another course's get a row for this course too). Any other link is
 * refused unless `keep` allows it: links the deck already had (decks from
 * before pictures were copied in) or a file being imported.
 */
export async function trackDeckImages(
  ctx: MutationCtx,
  actor: Actor,
  courseId: Id<"courses">,
  slides: SlideDoc[],
  keep: "all" | Set<string>,
): Promise<void> {
  const problems: string[] = [];
  for (const [i, slide] of slides.entries()) {
    if (slide.type !== "image") continue;
    const kalami = await claimKalamiPicture(ctx, courseId, slide.url, { ownerId: actor.user._id, via: actor.via });
    if (kalami !== null || keep === "all" || keep.has(slide.url)) continue;
    let host = slide.url;
    try {
      host = new URL(slide.url).hostname;
    } catch {
      // Shown as it is.
    }
    problems.push(`slides[${i}].url: the picture on ${host} has to be copied into Kalami first.`);
  }
  if (problems.length > 0) {
    throw appError(
      "INVALID_INPUT",
      `${problems.slice(0, 5).join(" ")} In the editor use Upload or Import a link; agents use import_image (create_presentation and update_presentation copy links in by themselves).`,
    );
  }
}

/** The image links of a deck as it is stored: the ones a save may keep. */
export function deckImageUrls(slides: SlideDoc[]): Set<string> {
  return new Set(slides.flatMap((slide) => (slide.type === "image" ? [slide.url] : [])));
}
