import { describe, expect, test } from "vitest";
import { resolveSlideIndex, slideKeyAction, slideStateKey, type SlideKeyEvent, type SlideKeyTarget } from "./slides";
import type { LessonBlock } from "./types";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("resolveSlideIndex", () => {
  test("an empty lesson has no slide", () => {
    expect(resolveSlideIndex([], "a", 3)).toBe(-1);
  });

  test("follows the active block wherever it moves", () => {
    expect(resolveSlideIndex(ids("a", "b", "c"), "c", 0)).toBe(2);
    // Reordered: c moved to the front.
    expect(resolveSlideIndex(ids("c", "a", "b"), "c", 2)).toBe(0);
  });

  test("a deleted active block hands over to the block now in its place", () => {
    // b (index 1) was deleted: c moves into its place.
    expect(resolveSlideIndex(ids("a", "c"), "b", 1)).toBe(1);
  });

  test("deleting the last block falls back to the new last slide, never out of range", () => {
    expect(resolveSlideIndex(ids("a", "b"), "c", 2)).toBe(1);
    expect(resolveSlideIndex(ids("a"), "gone", 7)).toBe(0);
  });

  test("no active block yet starts at the first slide", () => {
    expect(resolveSlideIndex(ids("a", "b"), null, 0)).toBe(0);
    expect(resolveSlideIndex(ids("a", "b"), null, -4)).toBe(0);
  });
});

describe("slideStateKey", () => {
  const check = (id: string, correct: number, prompt = "Which one?"): LessonBlock => ({
    id,
    type: "check",
    check: {
      kind: "single",
      prompt,
      options: [
        { text: "One", correct: correct === 0 },
        { text: "Two", correct: correct === 1 },
      ],
    },
  });

  test("answers never pass between blocks, even identical ones", () => {
    expect(slideStateKey(check("a", 0))).not.toBe(slideStateKey(check("b", 0)));
  });

  test("rewording the question keeps the answers", () => {
    expect(slideStateKey(check("a", 0, "Which one?"))).toBe(slideStateKey(check("a", 0, "Pick one")));
  });

  test("changing the answer key starts the check afresh", () => {
    expect(slideStateKey(check("a", 0))).not.toBe(slideStateKey(check("a", 1)));
  });

  test("steps keep their progress while reworded, and restart when their number changes", () => {
    const steps = (n: number, text = "Do it"): LessonBlock => ({
      id: "s",
      type: "steps",
      steps: Array.from({ length: n }, () => ({ md: text })),
    });
    expect(slideStateKey(steps(3, "Do it"))).toBe(slideStateKey(steps(3, "Do this")));
    expect(slideStateKey(steps(3))).not.toBe(slideStateKey(steps(4)));
  });

  test("blocks without answers are keyed by their id alone", () => {
    expect(slideStateKey({ id: "t", type: "text", md: "Hello" })).toBe("t");
  });
});

describe("slideKeyAction", () => {
  /** A target that matches `owns` selectors (as Element.closest would). */
  const target = (owns: string | null = null, size?: { scrollWidth: number; clientWidth: number }): SlideKeyTarget => ({
    closest: (selector: string) => (owns !== null && selector.split(", ").includes(owns) ? {} : null),
    ...size,
  });
  const press = (key: string, extra: Partial<SlideKeyEvent> = {}): SlideKeyEvent => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: target(),
    ...extra,
  });

  test("arrow keys move between slides", () => {
    expect(slideKeyAction(press("ArrowRight"))).toBe("next");
    expect(slideKeyAction(press("ArrowLeft"))).toBe("previous");
  });

  test("other keys are left alone", () => {
    for (const key of ["ArrowUp", "ArrowDown", "PageDown", " ", "Enter", "Home", "End", "a"]) {
      expect(slideKeyAction(press(key))).toBeNull();
    }
  });

  test("shortcuts with a modifier are never taken", () => {
    expect(slideKeyAction(press("ArrowLeft", { altKey: true }))).toBeNull();
    expect(slideKeyAction(press("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(slideKeyAction(press("ArrowRight", { metaKey: true }))).toBeNull();
    expect(slideKeyAction(press("ArrowRight", { shiftKey: true }))).toBeNull();
  });

  test("typing and quiz options keep their arrow keys", () => {
    for (const owner of ["input", "textarea", "select", "iframe", '[role="radio"]', '[role="menuitem"]', '[role="tab"]']) {
      expect(slideKeyAction(press("ArrowRight", { target: target(owner) }))).toBeNull();
    }
  });

  test("a wide code block that scrolls sideways keeps its arrow keys", () => {
    expect(slideKeyAction(press("ArrowRight", { target: target(null, { scrollWidth: 900, clientWidth: 400 }) }))).toBeNull();
    expect(slideKeyAction(press("ArrowRight", { target: target(null, { scrollWidth: 400, clientWidth: 400 }) }))).toBe("next");
  });

  test("a key something else already handled is ignored", () => {
    expect(slideKeyAction(press("ArrowRight", { defaultPrevented: true }))).toBeNull();
  });
});
