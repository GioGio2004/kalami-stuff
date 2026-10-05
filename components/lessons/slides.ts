import type { LessonBlock } from "./types";

// The rules behind the slide player (LessonSlides), kept free of React and the
// DOM so they can be tested on their own.

/**
 * Which slide is on show: the block with `activeId`, or, when that block is
 * gone (deleted in the editor, removed by a live update), the one that now sits
 * where it was. -1 only for an empty lesson.
 */
export function resolveSlideIndex(blocks: readonly { id: string }[], activeId: string | null, lastIndex: number): number {
  if (blocks.length === 0) return -1;
  const found = activeId === null ? -1 : blocks.findIndex((block) => block.id === activeId);
  if (found !== -1) return found;
  return Math.min(Math.max(lastIndex, 0), blocks.length - 1);
}

/**
 * Who a slide's answers and progress belong to. The block's id keeps them while
 * the student moves back and forth, and never lets them pass to another block.
 * For a quick check the answer key is part of it too, and for steps their
 * number: when a lecturer changes those, the old answers no longer fit and the
 * block starts afresh. Rewording a prompt or a step keeps them.
 */
export function slideStateKey(block: LessonBlock): string {
  switch (block.type) {
    case "check": {
      const { kind, options, accepted } = block.check;
      return `${block.id}:${hash(JSON.stringify([kind, options ?? [], accepted ?? []]))}`;
    }
    case "steps":
      return `${block.id}:${block.steps.length}`;
    default:
      return block.id;
  }
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** The parts of a keydown the player looks at (a DOM KeyboardEvent fits). */
export type SlideKeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: SlideKeyTarget | null;
};

export type SlideKeyTarget = {
  closest(selector: string): unknown;
  scrollWidth?: number;
  clientWidth?: number;
};

/** Anything that uses the arrow keys itself: typing, choosing, menus, tabs, embedded pages. */
const OWNS_ARROW_KEYS = [
  "input",
  "textarea",
  "select",
  "iframe",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="tablist"]',
  '[role="tab"]',
].join(", ");

/**
 * ← and → move between slides while focus is in the player, but never steal
 * the keys from a field, a quiz option, a menu or a wide code block that
 * scrolls sideways, and never take a shortcut (any modifier: Alt+← is Back,
 * Ctrl/⌘ combinations belong to the editor and the browser).
 */
export function slideKeyAction(event: SlideKeyEvent): "previous" | "next" | null {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
  const target = event.target;
  if (target !== null) {
    if (target.closest(OWNS_ARROW_KEYS) !== null) return null;
    if ((target.scrollWidth ?? 0) > (target.clientWidth ?? 0)) return null;
  }
  return event.key === "ArrowLeft" ? "previous" : "next";
}
