import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireCourseContentEditor, requireStaffActor } from "./lib/access";
import {
  mediaCallerValidator,
  mediaResultValidator,
  mediaTargetValidator,
  recordMedia,
  recordMediaArgs,
  startMedia,
} from "./model/media";

// Pictures copied into Kalami: the database side (model/media.ts). The work
// itself (download, compress to WebP, store on ImageKit) is mediaActions.ts.

/** Where the editor sends a picture file before mediaActions.upload compresses it (the file is deleted after). */
export const generateUploadUrl = mutation({
  args: { courseId: v.id("courses") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const actor = await requireStaffActor(ctx);
    await requireCourseContentEditor(ctx, actor, args.courseId);
    return await ctx.storage.generateUploadUrl();
  },
});

const startResultValidator = v.union(
  v.object({
    kind: v.literal("reuse"),
    result: mediaResultValidator,
  }),
  v.object({
    kind: v.literal("new"),
    courseId: v.id("courses"),
    ownerId: v.id("users"),
    via: v.union(v.literal("web"), v.literal("mcp")),
    sourceKey: v.optional(v.string()),
  }),
);

export const start = internalMutation({
  args: { caller: mediaCallerValidator, target: mediaTargetValidator, link: v.optional(v.string()) },
  returns: startResultValidator,
  handler: async (ctx, args) => await startMedia(ctx, args.caller, args.target, args.link),
});

export const record = internalMutation({
  args: recordMediaArgs,
  returns: mediaResultValidator,
  handler: async (ctx, args) => await recordMedia(ctx, args),
});
