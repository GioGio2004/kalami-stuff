"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { appError } from "./lib/errors";
import { fetchImage } from "./lib/media/fetch";
import { courseFolder, deleteFromImageKit, imageKitConfigured, uploadToImageKit } from "./lib/media/imagekit";
import { MEDIA_LIMITS, webpFileName } from "./lib/media/link";
import { processImage } from "./lib/media/pipeline";
import { mediaResultValidator, mediaTargetValidator, type MediaResult } from "./model/media";

/**
 * Copies a picture into Kalami: an upload from the editor (via Convex file
 * storage) or a link (a lecturer's or their agent's). Either way it is
 * decoded, turned upright, stripped of metadata, shrunk to fit 2400px and
 * compressed to WebP (lib/media/pipeline.ts), stored on Kalami's ImageKit in
 * the course's folder, and recorded in `media`. Slides then point at the
 * ImageKit address; the player asks ImageKit for the size each screen needs.
 */

type Caller = { kind: "web" } | { kind: "agent"; token: string; client?: string };
type Target = { courseId: Id<"courses"> } | { weekId: Id<"weeks"> } | { presentationId: Id<"presentations"> };
type Source = { kind: "upload"; name?: string; bytes: () => Promise<Uint8Array> } | { kind: "link"; url: string };

async function copyIn(ctx: ActionCtx, caller: Caller, target: Target, source: Source): Promise<MediaResult> {
  if (!imageKitConfigured()) {
    throw appError("CONFLICT", "Pictures aren't set up on this Kalami yet. Ask the administrator to connect ImageKit.");
  }
  const started = await ctx.runMutation(internal.media.start, {
    caller,
    target,
    link: source.kind === "link" ? source.url : undefined,
  });
  if (started.kind === "reuse") return started.result;

  let bytes: Uint8Array;
  let fileName: string;
  if (source.kind === "link") {
    const fetched = await fetchImage(source.url);
    bytes = fetched.bytes;
    fileName = webpFileName(fetched.finalUrl.pathname);
  } else {
    bytes = await source.bytes();
    fileName = webpFileName(source.name);
  }
  const image = await processImage(bytes);
  const stored = await uploadToImageKit({
    data: image.data,
    fileName,
    folder: courseFolder(started.courseId),
    tags: ["kalami", `course-${started.courseId}`, started.via === "mcp" ? "agent" : "editor"],
  });
  return await ctx.runMutation(internal.media.record, {
    courseId: started.courseId,
    ownerId: started.ownerId,
    via: started.via,
    fileId: stored.fileId,
    url: stored.url,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    originalBytes: bytes.byteLength,
    source:
      source.kind === "link"
        ? { kind: "link", url: source.url.trim().slice(0, MEDIA_LIMITS.url) }
        : { kind: "upload", name: source.name?.slice(0, MEDIA_LIMITS.fileName) },
    sourceKey: started.sourceKey,
  });
}

/** The editor's Upload: the file went to Convex storage first (media.generateUploadUrl); it's deleted afterwards. */
export const upload = action({
  args: { courseId: v.id("courses"), storageId: v.id("_storage"), name: v.optional(v.string()) },
  returns: mediaResultValidator,
  handler: async (ctx, args): Promise<MediaResult> => {
    try {
      return await copyIn(ctx, { kind: "web" }, { courseId: args.courseId }, {
        kind: "upload",
        name: args.name,
        bytes: async () => {
          const blob = await ctx.storage.get(args.storageId);
          if (blob === null) throw appError("NOT_FOUND", "The upload didn't arrive. Try again.");
          if (blob.size > MEDIA_LIMITS.inputBytes) {
            throw appError("INVALID_INPUT", `That picture is over ${MEDIA_LIMITS.inputBytes / 1024 / 1024} MB. Use a smaller one.`);
          }
          return new Uint8Array(await blob.arrayBuffer());
        },
      });
    } finally {
      await ctx.storage.delete(args.storageId).catch(() => undefined);
    }
  },
});

/** The editor's Import a link. */
export const importLink = action({
  args: { courseId: v.id("courses"), url: v.string() },
  returns: mediaResultValidator,
  handler: async (ctx, args): Promise<MediaResult> =>
    await copyIn(ctx, { kind: "web" }, { courseId: args.courseId }, { kind: "link", url: args.url }),
});

/**
 * An agent's picture link (the MCP tools import_image, create_presentation
 * and update_presentation). A link that is already a Kalami picture comes
 * back as it is, so agents can send every image slide through here.
 */
export const importForAgent = action({
  args: { token: v.string(), client: v.optional(v.string()), target: mediaTargetValidator, url: v.string() },
  returns: mediaResultValidator,
  handler: async (ctx, args): Promise<MediaResult> =>
    await copyIn(ctx, { kind: "agent", token: args.token, client: args.client }, args.target, { kind: "link", url: args.url }),
});

/** Removes pictures no course uses any more (scheduled when a course is deleted). */
export const deleteFiles = internalAction({
  args: { fileIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, args) => {
    if (!imageKitConfigured()) {
      console.warn(`Not deleting ${args.fileIds.length} pictures: IMAGEKIT_API_PRIVATE_KEY is missing.`);
      return null;
    }
    for (const fileId of args.fileIds) {
      try {
        await deleteFromImageKit(fileId);
      } catch (error) {
        console.error(error);
      }
    }
    return null;
  },
});
