// Presentations: decks of typed slides in a curated theme. This module holds
// the vocabulary, the limits and the rules, free of React and the DOM, so the
// backend checks a deck with the same code the editor and the player use. The
// backend (convex/model/presentations.ts) refuses a deck with any problem
// listed here; the editor shows the same problems while a lecturer edits; the
// player trusts what it gets.
//
// Nobody positions anything or picks colours: a slide is a type plus its words,
// and each type has a designed layout and choreography in the player
// (components/presentations). The theme decides every colour and typeface.
//
// The student app keeps a copy of this folder (scripts/sync-student.mjs); edit it here.

export * from "./geometry";

export const DECK_THEMES = ["ink", "paper", "aurora", "ember", "chalk"] as const;
export type DeckTheme = (typeof DECK_THEMES)[number];
export const DEFAULT_THEME: DeckTheme = "ink";

/** What each theme is for, in the words the editor and the agents read. */
export const THEME_INFO: Record<DeckTheme, { label: string; mood: string }> = {
  ink: { label: "Ink", mood: "Dark and bold, neon lime accents. Kalami's own look; the safe default." },
  paper: { label: "Paper", mood: "Light notebook paper with highlighter marks. Calm, good for reading-heavy topics." },
  aurora: { label: "Aurora", mood: "Deep night sky with drifting colour. Science, technology, big ideas." },
  ember: { label: "Ember", mood: "Warm cream and orange. Energetic: humanities, business, motivation." },
  chalk: { label: "Chalk", mood: "A classroom chalkboard with hand-drawn marks. Friendly, for beginners." },
};

export const SLIDE_TONES = ["default", "accent"] as const;
export type SlideTone = (typeof SLIDE_TONES)[number];

export const DIAGRAM_LAYOUTS = ["flow", "cycle", "stack", "hub"] as const;
export type DiagramLayout = (typeof DIAGRAM_LAYOUTS)[number];

export const IMAGE_LAYOUTS = ["split", "full"] as const;
export type ImageLayout = (typeof IMAGE_LAYOUTS)[number];

export const DECK_CODE_LANGUAGES = [
  "html",
  "css",
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "sql",
  "json",
  "bash",
  "text",
] as const;

export const SLIDE_TYPES = [
  "title",
  "section",
  "statement",
  "points",
  "number",
  "compare",
  "quote",
  "code",
  "image",
  "diagram",
  "closing",
] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];

/** Every slide may carry these: its id, a tone (accent fills the slide with the theme's accent colour) and speaker notes. */
type Common = { id: string; tone?: SlideTone; notes?: string };

export type CompareSide = { title: string; points: string[] };
export type CodeHighlight = { from: number; to?: number; note?: string };
/** `edge` labels the arrow that leads into this node. */
export type DiagramNode = { label: string; detail?: string; edge?: string };

export type Slide =
  | (Common & { type: "title"; title: string; subtitle?: string; kicker?: string })
  | (Common & { type: "section"; title: string; kicker?: string })
  | (Common & { type: "statement"; text: string; kicker?: string })
  | (Common & { type: "points"; title?: string; points: string[]; build?: boolean })
  | (Common & {
      type: "number";
      value: number;
      prefix?: string;
      suffix?: string;
      decimals?: number;
      label: string;
      detail?: string;
    })
  | (Common & { type: "compare"; title?: string; left: CompareSide; right: CompareSide; verdict?: string })
  | (Common & { type: "quote"; quote: string; author?: string; role?: string })
  | (Common & { type: "code"; title?: string; language: string; code: string; highlights?: CodeHighlight[] })
  | (Common & { type: "image"; url: string; alt: string; title?: string; caption?: string; layout?: ImageLayout })
  | (Common & { type: "diagram"; title?: string; layout: DiagramLayout; nodes: DiagramNode[]; build?: boolean })
  | (Common & { type: "closing"; title: string; points?: string[]; next?: string });

export type SlideOf<T extends SlideType> = Extract<Slide, { type: T }>;

/** A deck: the theme and the slides, in order. */
export type Deck = { theme: DeckTheme; slides: Slide[] };

/** What each slide type is for: the editor's menu and the agents' guidance. */
export const SLIDE_TYPE_INFO: Record<SlideType, { label: string; description: string }> = {
  title: { label: "Title", description: "The opening: a big title, an optional subtitle and a small kicker above it." },
  section: { label: "Section", description: "A chapter break with a big running number. Accent-coloured by default." },
  statement: { label: "Statement", description: "One sentence, very large. The idea you want remembered." },
  points: { label: "Points", description: "Two to six short points that arrive one after another." },
  number: { label: "Number", description: "One number that counts up, with what it means." },
  compare: { label: "Compare", description: "Two sides next to each other, with an optional verdict." },
  quote: { label: "Quote", description: "A quotation with who said it." },
  code: { label: "Code", description: "A code fragment that types itself, then highlights lines step by step." },
  image: { label: "Image", description: "A picture beside a title and caption, or filling the slide." },
  diagram: { label: "Diagram", description: "Two to eight labelled nodes joined by arrows: a flow, a cycle, a stack or a hub." },
  closing: { label: "Closing", description: "The end: a takeaway title, a short recap and what comes next." },
};

export const DECK_LIMITS = {
  slides: 60,
  deckTitle: 160,
  kicker: 60,
  headline: 120,
  subtitle: 220,
  statement: 180,
  slideTitle: 100,
  point: 160,
  points: 6,
  label: 120,
  detail: 220,
  affix: 12,
  quote: 320,
  author: 80,
  role: 100,
  code: 1_800,
  codeLines: 22,
  highlights: 8,
  highlightNote: 160,
  url: 2_000,
  alt: 300,
  caption: 220,
  sideTitle: 60,
  sidePoints: 5,
  sidePoint: 120,
  verdict: 160,
  nodes: 8,
  nodeLabel: 40,
  nodeDetail: 100,
  edge: 30,
  closingPoints: 5,
  next: 140,
  notes: 3_000,
} as const;

export const SLIDE_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

// --- Inline text: **accent** and `code` --------------------------------------------------

export type RichSegment = { kind: "text" | "accent" | "code"; text: string };

/**
 * Slide text may mark words with `**…**` (the theme's accent: a highlighter
 * mark, a hand-drawn underline, a glow) and `` `…` `` (code). Nothing else is
 * markup; an unmatched marker stays as it is.
 */
export function parseRich(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain !== "") out.push({ kind: "text", text: plain });
    plain = "";
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "accent", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** The words without markers: for screen readers, search and length checks. */
export function plainText(text: string): string {
  return parseRich(text)
    .map((segment) => segment.text)
    .join("");
}

// --- What the player needs (pure, so it's testable) --------------------------------------

/**
 * How many times Next stays on this slide before moving on: the "builds".
 * Points and diagrams with `build` reveal one item per press (the first comes
 * with the slide); code reveals one highlight per press after typing itself.
 */
export function slideSteps(slide: Slide): number {
  switch (slide.type) {
    case "points":
      return slide.build ? Math.max(0, slide.points.length - 1) : 0;
    case "diagram":
      return slide.build ? Math.max(0, slide.nodes.length - 1) : 0;
    case "code":
      return slide.highlights?.length ?? 0;
    default:
      return 0;
  }
}

/** The running number of each section slide (1, 2, 3 …), by slide index. */
export function sectionNumbers(slides: readonly Slide[]): Map<number, number> {
  const out = new Map<number, number>();
  let n = 0;
  slides.forEach((slide, i) => {
    if (slide.type === "section") {
      n += 1;
      out.set(i, n);
    }
  });
  return out;
}

/** The tone a slide shows in: sections are accent unless they say otherwise. */
export function slideTone(slide: Slide): SlideTone {
  return slide.tone ?? (slide.type === "section" ? "accent" : "default");
}

/** A short name for a slide: the editor's list, the overview, the screen reader's slide label. */
export function slideLabel(slide: Slide): string {
  const text = (() => {
    switch (slide.type) {
      case "title":
      case "section":
      case "closing":
        return slide.title;
      case "statement":
        return slide.text;
      case "points":
        return slide.title ?? slide.points[0] ?? "";
      case "number":
        return `${slide.prefix ?? ""}${slide.value}${slide.suffix ?? ""} ${slide.label}`;
      case "compare":
        return slide.title ?? `${slide.left.title} / ${slide.right.title}`;
      case "quote":
        return slide.quote;
      case "code":
        return slide.title ?? slide.language;
      case "image":
        return slide.title ?? slide.caption ?? slide.alt;
      case "diagram":
        return slide.title ?? slide.nodes.map((node) => node.label).join(" → ");
    }
  })();
  const plain = plainText(text).replace(/\s+/g, " ").trim();
  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
}

/** The words a deck shows, for search. */
export function deckText(deck: Deck): string {
  const parts: string[] = [];
  const add = (...values: (string | undefined)[]) => {
    for (const value of values) if (value) parts.push(plainText(value));
  };
  for (const slide of deck.slides) {
    switch (slide.type) {
      case "title":
        add(slide.kicker, slide.title, slide.subtitle);
        break;
      case "section":
        add(slide.kicker, slide.title);
        break;
      case "statement":
        add(slide.kicker, slide.text);
        break;
      case "points":
        add(slide.title, ...slide.points);
        break;
      case "number":
        add(`${slide.prefix ?? ""}${slide.value}${slide.suffix ?? ""}`, slide.label, slide.detail);
        break;
      case "compare":
        add(slide.title, slide.left.title, ...slide.left.points, slide.right.title, ...slide.right.points, slide.verdict);
        break;
      case "quote":
        add(slide.quote, slide.author, slide.role);
        break;
      case "code":
        add(slide.title, slide.code, ...(slide.highlights ?? []).map((h) => h.note));
        break;
      case "image":
        add(slide.title, slide.caption, slide.alt);
        break;
      case "diagram":
        add(slide.title, ...slide.nodes.flatMap((node) => [node.label, node.detail, node.edge]));
        break;
      case "closing":
        add(slide.title, ...(slide.points ?? []), slide.next);
        break;
    }
  }
  return parts.join(" ");
}

// --- Tidying and rules -------------------------------------------------------------------

const trimmed = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const text = value.replace(/\r\n/g, "\n").trim();
  return text === "" ? undefined : text;
};
const req = (value: string): string => value.replace(/\r\n/g, "\n").trim();
const list = (values: string[] | undefined): string[] | undefined =>
  values === undefined ? undefined : values.map(req).filter((value) => value !== "");

/** Drops keys whose value is undefined, so equal slides always serialise the same way. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * A slide with its text trimmed (line endings too), empty optional fields
 * left out and empty list items dropped: what gets stored and checked. Code
 * keeps its indentation; only trailing blank lines go.
 */
export function tidySlide<S extends Slide>(slide: S): S {
  const base = { id: slide.id, tone: slide.tone === "default" ? undefined : slide.tone, notes: trimmed(slide.notes) };
  const s = slide as Slide;
  let out: Slide;
  switch (s.type) {
    case "title":
      out = { ...base, type: "title", title: req(s.title), subtitle: trimmed(s.subtitle), kicker: trimmed(s.kicker) };
      break;
    case "section":
      out = { ...base, type: "section", title: req(s.title), kicker: trimmed(s.kicker) };
      // A section is accent unless asked otherwise, so "default" is the one worth keeping.
      out.tone = s.tone;
      break;
    case "statement":
      out = { ...base, type: "statement", text: req(s.text), kicker: trimmed(s.kicker) };
      break;
    case "points":
      out = { ...base, type: "points", title: trimmed(s.title), points: list(s.points) ?? [], build: s.build ? true : undefined };
      break;
    case "number":
      out = {
        ...base,
        type: "number",
        value: s.value,
        // A space between the affix and the number is meant ("≈ 3", "40 ms"); the outer ones aren't.
        prefix: s.prefix === undefined || s.prefix.trim() === "" ? undefined : s.prefix.replace(/^\s+/, ""),
        suffix: s.suffix === undefined || s.suffix.trim() === "" ? undefined : s.suffix.replace(/\s+$/, ""),
        decimals: s.decimals === 0 ? undefined : s.decimals,
        label: req(s.label),
        detail: trimmed(s.detail),
      };
      break;
    case "compare":
      out = {
        ...base,
        type: "compare",
        title: trimmed(s.title),
        left: { title: req(s.left.title), points: list(s.left.points) ?? [] },
        right: { title: req(s.right.title), points: list(s.right.points) ?? [] },
        verdict: trimmed(s.verdict),
      };
      break;
    case "quote":
      out = { ...base, type: "quote", quote: req(s.quote), author: trimmed(s.author), role: trimmed(s.role) };
      break;
    case "code":
      out = {
        ...base,
        type: "code",
        title: trimmed(s.title),
        language: s.language.trim().toLowerCase(),
        code: s.code.replace(/\r\n/g, "\n").replace(/\s+$/, "").replace(/^\n+/, ""),
        highlights:
          s.highlights && s.highlights.length > 0
            ? s.highlights.map((h) => clean({ from: h.from, to: h.to === undefined || h.to === h.from ? undefined : h.to, note: trimmed(h.note) }))
            : undefined,
      };
      break;
    case "image":
      out = {
        ...base,
        type: "image",
        url: req(s.url),
        alt: req(s.alt),
        title: trimmed(s.title),
        caption: trimmed(s.caption),
        layout: s.layout === "split" ? undefined : s.layout,
      };
      break;
    case "diagram":
      out = {
        ...base,
        type: "diagram",
        title: trimmed(s.title),
        layout: s.layout,
        nodes: s.nodes
          .map((node) => clean({ label: req(node.label), detail: trimmed(node.detail), edge: trimmed(node.edge) }))
          .filter((node) => node.label !== "" || node.detail !== undefined),
        build: s.build ? true : undefined,
      };
      break;
    case "closing": {
      const points = list(s.points);
      out = { ...base, type: "closing", title: req(s.title), points: points && points.length > 0 ? points : undefined, next: trimmed(s.next) };
      break;
    }
  }
  return clean(out) as S;
}

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function isHttps(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * What keeps a deck from being accepted, every problem at once, each with
 * where it is ("slides[3].points: …"). Empty means the deck is fine. Shapes
 * are assumed to match the type (the backend's validators guarantee that);
 * these are the rules a type can't say. Lengths count the words people see,
 * without the ** and ` markers.
 */
export function deckProblems(deck: Deck): string[] {
  const out: string[] = [];
  const L = DECK_LIMITS;
  if (!(DECK_THEMES as readonly string[]).includes(deck.theme)) out.push(`theme: one of ${DECK_THEMES.join(", ")}.`);
  if (deck.slides.length === 0) out.push("slides: add at least one slide.");
  if (deck.slides.length > L.slides) out.push(`slides: at most ${L.slides} slides.`);

  const ids = new Set<string>();
  deck.slides.forEach((slide, i) => {
    const at = `slides[${i}]`;
    const text = (value: string | undefined, field: string, max: number, required = false) => {
      if (value === undefined || value.trim() === "") {
        if (required) out.push(`${at}.${field}: can't be empty.`);
        return;
      }
      if (plainText(value).length > max) out.push(`${at}.${field}: at most ${max} characters (keep slide text short).`);
    };
    const items = (values: string[], field: string, min: number, max: number, each: number) => {
      if (values.length < min || values.length > max) out.push(`${at}.${field}: ${min} to ${max} items.`);
      values.forEach((value, n) => text(value, `${field}[${n}]`, each, true));
    };

    if (slide.id !== "" && !SLIDE_ID_PATTERN.test(slide.id)) out.push(`${at}.id: letters, digits, - or _, up to 40.`);
    if (slide.id !== "" && ids.has(slide.id)) out.push(`${at}.id: "${slide.id}" is used twice.`);
    if (slide.id !== "") ids.add(slide.id);
    if (slide.tone !== undefined && !(SLIDE_TONES as readonly string[]).includes(slide.tone)) out.push(`${at}.tone: default or accent.`);
    if (slide.notes !== undefined && slide.notes.length > L.notes) out.push(`${at}.notes: at most ${L.notes} characters.`);

    switch (slide.type) {
      case "title":
        text(slide.title, "title", L.headline, true);
        text(slide.subtitle, "subtitle", L.subtitle);
        text(slide.kicker, "kicker", L.kicker);
        break;
      case "section":
        text(slide.title, "title", L.slideTitle, true);
        text(slide.kicker, "kicker", L.kicker);
        break;
      case "statement":
        text(slide.text, "text", L.statement, true);
        text(slide.kicker, "kicker", L.kicker);
        break;
      case "points":
        text(slide.title, "title", L.slideTitle);
        items(slide.points, "points", 2, L.points, L.point);
        break;
      case "number":
        if (!isFiniteNumber(slide.value) || Math.abs(slide.value) > 1e12) out.push(`${at}.value: a number.`);
        if (slide.decimals !== undefined && (!Number.isInteger(slide.decimals) || slide.decimals < 0 || slide.decimals > 3)) {
          out.push(`${at}.decimals: 0 to 3.`);
        }
        text(slide.prefix, "prefix", L.affix);
        text(slide.suffix, "suffix", L.affix);
        text(slide.label, "label", L.label, true);
        text(slide.detail, "detail", L.detail);
        break;
      case "compare":
        text(slide.title, "title", L.slideTitle);
        for (const side of ["left", "right"] as const) {
          text(slide[side].title, `${side}.title`, L.sideTitle, true);
          if (slide[side].points.length < 1 || slide[side].points.length > L.sidePoints) out.push(`${at}.${side}.points: 1 to ${L.sidePoints} items.`);
          slide[side].points.forEach((value, n) => text(value, `${side}.points[${n}]`, L.sidePoint, true));
        }
        text(slide.verdict, "verdict", L.verdict);
        break;
      case "quote":
        text(slide.quote, "quote", L.quote, true);
        text(slide.author, "author", L.author);
        text(slide.role, "role", L.role);
        break;
      case "code": {
        text(slide.title, "title", L.slideTitle);
        if (!(DECK_CODE_LANGUAGES as readonly string[]).includes(slide.language)) out.push(`${at}.language: one of ${DECK_CODE_LANGUAGES.join(", ")}.`);
        const lines = slide.code.split("\n").length;
        if (slide.code.trim() === "" || slide.code.length > L.code) out.push(`${at}.code: 1 to ${L.code} characters.`);
        else if (lines > L.codeLines) out.push(`${at}.code: at most ${L.codeLines} lines; a slide shows a fragment, not a file.`);
        const highlights = slide.highlights ?? [];
        if (highlights.length > L.highlights) out.push(`${at}.highlights: at most ${L.highlights}.`);
        highlights.forEach((h, n) => {
          const to = h.to ?? h.from;
          if (!Number.isInteger(h.from) || !Number.isInteger(to) || h.from < 1 || to < h.from || to > lines) {
            out.push(`${at}.highlights[${n}]: lines ${h.from}${h.to !== undefined ? `-${h.to}` : ""} aren't in the code (it has ${lines} lines; from ≤ to).`);
          }
          text(h.note, `highlights[${n}].note`, L.highlightNote);
        });
        break;
      }
      case "image":
        if (!isHttps(slide.url) || slide.url.length > L.url) out.push(`${at}.url: an https:// link to the image.`);
        text(slide.alt, "alt", L.alt, true);
        text(slide.title, "title", L.slideTitle);
        text(slide.caption, "caption", L.caption);
        if (slide.layout !== undefined && !(IMAGE_LAYOUTS as readonly string[]).includes(slide.layout)) out.push(`${at}.layout: split or full.`);
        break;
      case "diagram": {
        text(slide.title, "title", L.slideTitle);
        if (!(DIAGRAM_LAYOUTS as readonly string[]).includes(slide.layout)) out.push(`${at}.layout: one of ${DIAGRAM_LAYOUTS.join(", ")}.`);
        const min = slide.layout === "cycle" || slide.layout === "hub" ? 3 : 2;
        if (slide.nodes.length < min || slide.nodes.length > L.nodes) {
          out.push(`${at}.nodes: ${min} to ${L.nodes} nodes for a ${slide.layout}.`);
        }
        slide.nodes.forEach((node, n) => {
          text(node.label, `nodes[${n}].label`, L.nodeLabel, true);
          text(node.detail, `nodes[${n}].detail`, L.nodeDetail);
          text(node.edge, `nodes[${n}].edge`, L.edge);
        });
        break;
      }
      case "closing":
        text(slide.title, "title", L.slideTitle, true);
        if (slide.points !== undefined) items(slide.points, "points", 0, L.closingPoints, L.point);
        text(slide.next, "next", L.next);
        break;
    }
  });
  return out;
}
