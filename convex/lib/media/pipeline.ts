"use node";

import sharp, { type Metadata, type OutputInfo } from "sharp";
import { appError } from "../errors";
import { MEDIA_LIMITS } from "./link";

// Turns any picture people bring (a phone photo, a screenshot, a diagram, a
// GIF) into one light WebP: decoded with limits, turned upright, every bit of
// metadata dropped (phone photos carry the GPS position), shrunk to fit
// MEDIA_LIMITS.side and compressed. Node only: imported from mediaActions.ts.

sharp.cache(false);
sharp.concurrency(1);

/** What people bring that sharp can read. HEIC from iPhones isn't here: browsers send JPEG. */
const READABLE = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff", "svg", "heif"]);
/** Flat-colour sources: screenshots, diagrams, logos. They get a higher quality so edges stay crisp. */
const GRAPHICS = new Set(["png", "gif", "svg"]);

export type ProcessedImage = {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
  animated: boolean;
  /** What it was before: jpeg, png, … */
  inputFormat: string;
  quality: number;
};

function unreadable(): never {
  throw appError("INVALID_INPUT", "That file isn't a picture Kalami can read. Use a JPG, PNG, WebP, GIF, AVIF or SVG.");
}

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) unreadable();
  if (input.byteLength > MEDIA_LIMITS.inputBytes) {
    throw appError("INVALID_INPUT", `That picture is over ${MEDIA_LIMITS.inputBytes / 1024 / 1024} MB. Use a smaller one.`);
  }
  // The header only, without the pixel limit (it would throw here): the size is checked just below.
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: "error", limitInputPixels: false }).metadata();
  } catch {
    unreadable();
  }
  const format = String(meta.format);
  if (!READABLE.has(format)) unreadable();
  const pixelLimit = format === "jpeg" || format === "webp" ? MEDIA_LIMITS.inputPixelsShrinkable : MEDIA_LIMITS.inputPixels;
  if (meta.width * meta.height > pixelLimit) {
    throw appError(
      "INVALID_INPUT",
      `That picture is ${meta.width}×${meta.height} pixels, more than Kalami takes (${Math.round(pixelLimit / 1e6)} megapixels). Use a smaller version.`,
    );
  }
  const options = { failOn: "error" as const, limitInputPixels: pixelLimit };

  const frames = meta.pages ?? 1;
  const animated = (format === "gif" || format === "webp") && frames > 1;
  const pageHeight = animated ? (meta.pageHeight ?? meta.height) : meta.height;
  // All the frames of an animation are decoded at once, so they share the one pixel budget.
  if (animated && meta.width * pageHeight * Math.min(frames, MEDIA_LIMITS.frames) > MEDIA_LIMITS.inputPixels) {
    throw appError("INVALID_INPUT", "That animation is too big. Use a shorter or smaller one.");
  }

  // Vector pictures are drawn at a density that makes them about as large as a stored picture gets.
  const longest = Math.max(meta.width, pageHeight, 1);
  const density = format === "svg" ? Math.min(10_000, Math.max(72, (72 * MEDIA_LIMITS.side) / longest)) : undefined;

  const graphic = GRAPHICS.has(format);
  let quality = graphic ? 88 : 80;
  for (;;) {
    let image = sharp(input, {
      ...options,
      density,
      animated,
      pages: animated ? Math.min(frames, MEDIA_LIMITS.frames) : 1,
      autoOrient: !animated,
    });
    image = image.resize({
      width: MEDIA_LIMITS.side,
      height: MEDIA_LIMITS.side,
      fit: "inside",
      withoutEnlargement: true,
    });
    let out: { data: Buffer; info: OutputInfo };
    try {
      out = await image
        .webp({ quality, alphaQuality: 90, effort: 4, smartSubsample: !graphic, loop: 0 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      unreadable();
    }
    const { data, info } = out;
    if (data.byteLength <= MEDIA_LIMITS.targetBytes || quality <= 55) {
      return {
        data,
        width: info.width,
        height: animated ? (info.pageHeight ?? info.height) : info.height,
        bytes: data.byteLength,
        animated,
        inputFormat: format,
        quality,
      };
    }
    quality -= 10;
  }
}
