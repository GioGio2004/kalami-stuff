// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MEDIA_LIMITS } from "./link";
import { processImage } from "./pipeline";

const solid = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha } } });

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return JSON.stringify((error as { data?: unknown }).data ?? String(error));
  }
  return "no error";
}

describe("processImage", () => {
  it("turns a phone photo upright and drops its metadata, GPS included", async () => {
    const photo = await solid(300, 200)
      .jpeg()
      .withExif({
        IFD0: { Artist: "Someone", Make: "Phone" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 43/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "44/1 47/1 0/1" },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();

    const out = await processImage(photo);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect([out.width, out.height]).toEqual([200, 300]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.inputFormat).toBe("jpeg");
  });

  it("shrinks a big picture to fit the longest side, never enlarges a small one", async () => {
    const big = await processImage(await solid(4800, 1200).png().toBuffer());
    expect([big.width, big.height]).toEqual([MEDIA_LIMITS.side, 600]);
    const small = await processImage(await solid(120, 80).png().toBuffer());
    expect([small.width, small.height]).toEqual([120, 80]);
  });

  it("keeps transparency", async () => {
    const out = await processImage(await solid(64, 64, 0.5).png().toBuffer());
    expect((await sharp(out.data).metadata()).hasAlpha).toBe(true);
  });

  it("draws an SVG large enough for a slide", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#c8ff00"/></svg>');
    const out = await processImage(svg);
    expect(out.inputFormat).toBe("svg");
    expect(out.width).toBe(MEDIA_LIMITS.side);
    expect(out.height).toBe(MEDIA_LIMITS.side / 2);
  });

  it("keeps an animation animated", async () => {
    const frames = await Promise.all([0, 1, 2].map((i) => solid(40, 30, 1).modulate({ hue: i * 90 }).png().toBuffer()));
    const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    const out = await processImage(gif);
    expect(out.animated).toBe(true);
    expect([out.width, out.height]).toEqual([40, 30]);
    expect((await sharp(out.data).metadata()).pages).toBe(3);
  });

  it("makes a photo much lighter", async () => {
    // Noise compresses badly, like a real photo.
    const noise = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 30 } } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const out = await processImage(noise);
    expect(out.bytes).toBeLessThan(noise.byteLength);
    expect(out.bytes).toBeLessThanOrEqual(MEDIA_LIMITS.targetBytes);
  });

  it("refuses what isn't a picture", async () => {
    expect(await errorOf(processImage(new TextEncoder().encode("<!doctype html><p>not a picture</p>")))).toContain("INVALID_INPUT");
    expect(await errorOf(processImage(new Uint8Array()))).toContain("INVALID_INPUT");
  });

  it("refuses a file over the size limit before decoding it", async () => {
    expect(await errorOf(processImage(new Uint8Array(MEDIA_LIMITS.inputBytes + 1)))).toContain("MB");
  });
});
