import type { PresentationDetail } from "@/components/studio/types";
import { deckProblems, tidySlide, type DeckTheme, type Slide, type SlideType } from "@/lib/presentation";

/**
 * The presentation editor's working copy. Each slide carries a `key` that
 * stays put while the lecturer edits (React keys, focus, the preview's
 * selection); `slide.id` is the server's id, empty until the slide has been
 * saved once.
 */
export type DraftSlide = { key: string; slide: Slide };

export type SlideInput = NonNullable<Parameters<typeof toInputs>[0]>[number]["slide"];

let counter = 0;
/** A key for a slide made in this editor; "~" never appears in a server id, so they can't collide. */
export function newKey(): string {
  counter += 1;
  return `new~${counter}`;
}

export function fromServer(slides: PresentationDetail["slides"]): DraftSlide[] {
  return slides.map((slide) => ({ key: slide.id, slide: slide as Slide }));
}

/** The server's slides, keeping the keys of slides the editor already has (by id), so forms don't remount. */
export function adopt(slides: PresentationDetail["slides"], current: DraftSlide[]): DraftSlide[] {
  const keyById = new Map(current.filter((item) => item.slide.id !== "").map((item) => [item.slide.id, item.key]));
  return slides.map((slide) => ({ key: keyById.get(slide.id) ?? slide.id, slide: slide as Slide }));
}

/** What the server gets: tidied slides, the id only once a slide has one. */
export function toInputs(items: DraftSlide[]) {
  return items.map((item) => {
    const { id, ...rest } = tidySlide(item.slide);
    return id === "" ? rest : { id, ...rest };
  });
}

/** The deck's content as one string, ids left out: equal strings mean nothing to save. */
export function contentKey(theme: DeckTheme, items: DraftSlide[]): string {
  return JSON.stringify([theme, items.map((item) => ({ ...tidySlide(item.slide), id: "" }))]);
}

export function duplicate(item: DraftSlide): DraftSlide {
  return { key: newKey(), slide: { ...structuredClone(item.slide), id: "" } };
}

/**
 * A new slide of a type, filled with short placeholder words so the preview
 * shows the layout straight away; the lecturer writes over them.
 */
export function blankSlide(type: SlideType): Slide {
  const id = "";
  switch (type) {
    case "title":
      return { id, type, kicker: "Week 1", title: "Presentation title", subtitle: "One line about what it covers" };
    case "section":
      return { id, type, title: "Section title" };
    case "statement":
      return { id, type, text: "One sentence with the **big idea**." };
    case "points":
      return { id, type, title: "Three things to know", points: ["First point", "Second point", "Third point"] };
    case "number":
      return { id, type, value: 42, label: "what the number means" };
    case "compare":
      return {
        id,
        type,
        title: "Before and after",
        left: { title: "Before", points: ["How it was"] },
        right: { title: "After", points: ["How it is now"] },
      };
    case "quote":
      return { id, type, quote: "The quotation, word for word.", author: "Who said it" };
    case "code":
      return { id, type, title: "An example", language: "html", code: '<p class="intro">Hello</p>' };
    case "image":
      return { id, type, url: "", alt: "", title: "What the picture shows" };
    case "diagram":
      return { id, type, title: "How it flows", layout: "flow", nodes: [{ label: "Start" }, { label: "Middle" }, { label: "End" }] };
    case "closing":
      return { id, type, title: "Thank you", points: ["The one thing to remember"] };
  }
}

/**
 * The deck's problems, by slide (index → messages in the lecturer's words),
 * plus any about the whole deck. Uses the same rules as the server.
 */
export function problemsBySlide(theme: DeckTheme, items: DraftSlide[]): { slides: Map<number, string[]>; deck: string[] } {
  const slides = new Map<number, string[]>();
  const deck: string[] = [];
  for (const problem of deckProblems({ theme, slides: items.map((item) => tidySlide(item.slide)) })) {
    const match = /^slides\[(\d+)\](?:\.([^:]+))?:?\s*(.*)$/.exec(problem);
    if (!match) {
      deck.push(problem);
      continue;
    }
    const index = Number(match[1]);
    const message = match[2] ? `${fieldName(match[2])}: ${match[3]}` : match[3];
    slides.set(index, [...(slides.get(index) ?? []), message]);
  }
  return { slides, deck };
}

/** "left.points[2]" → "Left point 3"; "nodes[1].label" → "Node 2 label". */
function fieldName(path: string): string {
  const words = path
    .replace(/\[(\d+)\]/g, (_, n: string) => ` ${Number(n) + 1}`)
    .split(".")
    .map((part) => part.replace(/s (\d+)$/, " $1"))
    .join(" ");
  const text = words.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
