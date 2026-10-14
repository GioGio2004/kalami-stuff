import { describe, expect, it } from "vitest";
import { imageSrcSet, isKalamiImage, sizedImage } from "./images";

const KALAMI = "https://ik.imagekit.io/kalami/dev/courses/c1/cat_x1.webp";

describe("deck pictures", () => {
  it("knows Kalami's pictures from links to other sites", () => {
    expect(isKalamiImage(KALAMI)).toBe(true);
    expect(isKalamiImage("https://ik.imagekit.io/kalamix/cat.webp")).toBe(false);
    expect(isKalamiImage("https://example.com/cat.png")).toBe(false);
  });

  it("asks ImageKit for the width the screen needs, never enlarged", () => {
    expect(sizedImage(KALAMI, 1280)).toBe(`${KALAMI}?tr=w-1280,c-at_max`);
    expect(sizedImage(`${KALAMI}?v=2`, 640)).toBe(`${KALAMI}?v=2&tr=w-640,c-at_max`);
    expect(imageSrcSet(KALAMI)?.split(", ")).toHaveLength(5);
  });

  it("leaves other links and already transformed ones as they are", () => {
    expect(sizedImage("https://example.com/cat.png", 640)).toBe("https://example.com/cat.png");
    expect(sizedImage(`${KALAMI}?tr=w-300`, 640)).toBe(`${KALAMI}?tr=w-300`);
    expect(imageSrcSet("data:image/svg+xml,<svg/>")).toBeUndefined();
  });
});
