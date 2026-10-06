import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { SplitText } from "gsap/SplitText";
import { slideSteps, type Slide, type SlideOf } from "@/lib/presentation";
import { layoutDiagram } from "./diagram";
import { formatNumber } from "./format";

/**
 * Each slide type's choreography: one GSAP timeline over the slide's DOM (the
 * layouts in views.tsx, found by `data-k`). The entrance plays to the label
 * "s0"; every build (a point, a diagram node, a code highlight) adds a stretch
 * ending at "s1", "s2" …, as many as slideSteps() says. The player moves the
 * playhead between labels, so Back plays a build in reverse and leaving a
 * slide rewinds it.
 *
 * The vocabulary is small and shared, so every deck moves the same way:
 * headings rise line by line out of masks, statements arrive word by word out
 * of a blur, kickers decode, accent marks draw on after their words, numbers
 * count, code types itself, arrows draw from node to node.
 *
 * Always built inside a gsap.context (the player reverts it), and `restore`
 * puts back what tweens can't (text a counter or a scramble rewrote, splits).
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */

let registered = false;

export function registerDeckGsap(): void {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(SplitText, DrawSVGPlugin, CustomEase);
  // A long, soft landing for everything that arrives; a firm one for things that travel.
  CustomEase.create("deck-out", "0.16, 1, 0.3, 1");
  CustomEase.create("deck-in-out", "0.76, 0, 0.24, 1");
  // For poking at a deck from the browser's console while developing.
  if (process.env.NODE_ENV !== "production") (window as unknown as { __deckGsap?: typeof gsap }).__deckGsap = gsap;
  registered = true;
}

export type Choreography = {
  tl: gsap.core.Timeline;
  /** labels[i] is where the timeline is once step i has played; labels[0] ends the entrance. */
  labels: string[];
  /** Puts back what isn't a tween. Call after reverting the context. */
  restore: () => void;
};

type Stage = {
  tl: gsap.core.Timeline;
  root: HTMLElement;
  /** 1cqmin of the stage, in pixels. */
  u: number;
  restores: (() => void)[];
  labels: string[];
};

export function choreograph(slide: Slide, root: HTMLElement): Choreography {
  registerDeckGsap();
  const stage = root.closest<HTMLElement>("[data-deck-stage]") ?? root;
  const st: Stage = {
    tl: gsap.timeline({ paused: true, defaults: { ease: "deck-out" } }),
    root,
    u: Math.min(stage.clientWidth, stage.clientHeight) / 100 || 4,
    restores: [],
    labels: [],
  };
  switch (slide.type) {
    case "title":
      title(st);
      break;
    case "section":
      section(st);
      break;
    case "statement":
      statement(st);
      break;
    case "points":
      points(st, slide);
      break;
    case "number":
      number(st);
      break;
    case "compare":
      compare(st);
      break;
    case "quote":
      quote(st);
      break;
    case "code":
      code(st, slide);
      break;
    case "image":
      image(st);
      break;
    case "diagram":
      diagram(st, slide);
      break;
    case "closing":
      closing(st);
      break;
  }
  // Every step the player can ask for has a label, whatever happened above.
  const want = slideSteps(slide) + 1;
  while (st.labels.length < want) label(st);
  return {
    tl: st.tl,
    labels: st.labels,
    restore: () => {
      for (const undo of st.restores.reverse()) undo();
    },
  };
}

// --- Primitives ---------------------------------------------------------------------------

const pick = (scope: ParentNode | null | undefined, name: string) => scope?.querySelector<HTMLElement>(`[data-k="${name}"]`) ?? null;
const pickAll = (scope: ParentNode | null | undefined, name: string) =>
  scope ? Array.from(scope.querySelectorAll<HTMLElement>(`[data-k="${name}"]`)) : [];

function label(st: Stage): void {
  const name = `s${st.labels.length}`;
  st.tl.addLabel(name, st.tl.duration());
  st.labels.push(name);
}

/** Lines rise out of masks, one after another. Returns when the last one lands. */
function lines(st: Stage, el: HTMLElement | null, at: number, o: { duration?: number; stagger?: number } = {}): number {
  if (!el) return at;
  const split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "deck-line", aria: "none" });
  st.restores.push(() => split.revert());
  if (split.lines.length === 0) return at;
  const duration = o.duration ?? 1.15;
  const stagger = o.stagger ?? 0.09;
  st.tl.from(split.lines, { yPercent: 135, rotate: 2.4, transformOrigin: "0% 0%", duration, stagger }, at);
  return at + duration + stagger * (split.lines.length - 1);
}

/** Words drift up out of a blur: the big sentences. */
function words(st: Stage, el: HTMLElement | null, at: number, o: { duration?: number } = {}): number {
  if (!el) return at;
  const split = SplitText.create(el, { type: "words", wordsClass: "deck-word", aria: "none" });
  st.restores.push(() => split.revert());
  const n = split.words.length;
  if (n === 0) return at;
  const duration = o.duration ?? 1.05;
  const stagger = Math.min(0.065, 1.35 / n);
  st.tl.fromTo(
    split.words,
    { opacity: 0, yPercent: 46, filter: "blur(14px)" },
    { opacity: 1, yPercent: 0, filter: "blur(0px)", duration, stagger },
    at,
  );
  return at + duration + stagger * (n - 1);
}

/** Accent marks under (or behind, or round) their words draw on. */
function marks(st: Stage, scope: ParentNode | null, at: number): void {
  if (!scope) return;
  const found = Array.from(scope.querySelectorAll<HTMLElement>("[data-accent]"));
  if (found.length === 0) return;
  st.tl.fromTo(found, { "--mark": 0 }, { "--mark": 1, duration: 0.85, stagger: 0.14, ease: "deck-in-out" }, Math.max(0, at));
}

function rise(st: Stage, el: HTMLElement | null, at: number, o: { y?: number; duration?: number } = {}): number {
  if (!el) return at;
  const duration = o.duration ?? 1;
  st.tl.from(el, { opacity: 0, y: (o.y ?? 3) * st.u, duration }, at);
  return at + duration;
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>*+#=";

/** The text so far, with a few random glyphs running ahead of it. */
function scrambled(text: string, p: number): string {
  if (p <= 0) return "";
  if (p >= 1) return text;
  const shown = Math.floor(text.length * p);
  let out = text.slice(0, shown);
  const ahead = Math.min(text.length - shown, 4);
  for (let i = 0; i < ahead; i++) {
    out += text[shown + i] === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return out;
}

/** A label decodes itself, letter by letter. */
function decode(st: Stage, el: HTMLElement | null, at: number, duration = 0.9): number {
  const final = el?.textContent ?? "";
  if (!el || final === "") return at;
  const state = { p: 0 };
  el.textContent = "";
  st.restores.push(() => {
    el.textContent = final;
  });
  st.tl.to(
    state,
    {
      p: 1,
      duration,
      ease: "power1.inOut",
      onUpdate: () => {
        el.textContent = scrambled(final, state.p);
      },
    },
    at,
  );
  return at + duration;
}

function kicker(st: Stage, at: number): number {
  const el = pick(st.root, "kicker");
  if (!el) return at;
  st.tl.from(el, { opacity: 0, x: -1.5 * st.u, duration: 0.7 }, at);
  return decode(st, pick(el, "kickerText"), at + 0.05);
}

/** A number counts up to itself. Its box keeps its final width, so nothing around it moves. */
function count(st: Stage, el: HTMLElement | null, at: number, duration: number): void {
  if (!el) return;
  const value = Number(el.dataset.value ?? 0);
  const decimals = Number(el.dataset.decimals ?? 0);
  const final = el.textContent ?? "";
  const width = el.getBoundingClientRect().width;
  el.style.display = "inline-block";
  el.style.minWidth = `${width}px`;
  el.style.textAlign = "right";
  el.textContent = formatNumber(0, decimals);
  st.restores.push(() => {
    el.textContent = final;
    el.style.display = "";
    el.style.minWidth = "";
    el.style.textAlign = "";
  });
  const state = { v: 0 };
  st.tl.to(
    state,
    {
      v: value,
      duration,
      ease: "power3.out",
      onUpdate: () => {
        el.textContent = state.v === value ? final : formatNumber(state.v, decimals);
      },
    },
    at,
  );
}

// --- Slide types --------------------------------------------------------------------------

function title(st: Stage): void {
  const { tl, root } = st;
  const orb = pick(root, "orb");
  if (orb) tl.from(orb, { opacity: 0, scale: 0.55, rotate: -50, duration: 2.6 }, 0);
  const afterKicker = kicker(st, 0.15);
  const heading = pick(root, "title");
  const end = lines(st, heading, pick(root, "kicker") ? 0.3 : 0.12, { duration: 1.3, stagger: 0.11 });
  marks(st, heading, end - 0.45);
  rise(st, pick(root, "subtitle"), Math.max(0.75, Math.min(afterKicker, end - 0.55)), { y: 2.6, duration: 1.1 });
  label(st);
}

function section(st: Stage): void {
  const { tl, root } = st;
  const num = pick(root, "number");
  if (num) {
    const split = SplitText.create(num, { type: "chars", mask: "chars", charsClass: "deck-char", aria: "none" });
    st.restores.push(() => split.revert());
    tl.from(split.chars, { yPercent: 108, duration: 1.45, stagger: 0.09 }, 0);
  }
  const rule = pick(root, "rule");
  if (rule) tl.from(rule, { scaleX: 0, duration: 1.4, ease: "deck-in-out" }, 0.15);
  kicker(st, 0.35);
  const heading = pick(root, "title");
  const end = lines(st, heading, 0.42);
  marks(st, heading, end - 0.4);
  label(st);
}

function statement(st: Stage): void {
  kicker(st, 0);
  const text = pick(st.root, "statement");
  const end = words(st, text, pick(st.root, "kicker") ? 0.2 : 0.05);
  marks(st, text, end - 0.35);
  label(st);
}

function points(st: Stage, slide: SlideOf<"points">): void {
  const { tl, root } = st;
  const heading = pick(root, "title");
  let start = 0.1;
  if (heading) {
    const end = lines(st, heading, 0);
    marks(st, heading, end - 0.4);
    start = 0.38;
  }
  const reveal = (item: HTMLElement, at: number) => {
    const rule = pick(item, "pointRule");
    if (rule) tl.from(rule, { scaleX: 0, duration: 1.15, ease: "deck-in-out" }, at);
    const num = pick(item, "pointNum");
    if (num) tl.from(num, { opacity: 0, x: -1.6 * st.u, duration: 0.75 }, at + 0.14);
    const text = pick(item, "pointText");
    const end = lines(st, text, at + 0.08, { duration: 1.05, stagger: 0.07 });
    marks(st, text, end - 0.42);
  };
  const items = pickAll(root, "point");
  if (!slide.build) {
    items.forEach((item, i) => reveal(item, start + i * 0.17));
    label(st);
    return;
  }
  if (items[0]) reveal(items[0], start);
  label(st);
  for (const item of items.slice(1)) {
    reveal(item, tl.duration());
    label(st);
  }
}

function number(st: Stage): void {
  const { tl, root } = st;
  const big = pick(root, "number");
  if (big) tl.from(big, { opacity: 0, yPercent: 22, duration: 1.3 }, 0);
  count(st, pick(root, "count"), 0.05, 2);
  const caption = pick(root, "label");
  const end = lines(st, caption, 0.4);
  marks(st, caption, end - 0.4);
  rise(st, pick(root, "detail"), 0.95, { y: 2 });
  label(st);
}

function compare(st: Stage): void {
  const { tl, root, u } = st;
  const heading = pick(root, "title");
  if (heading) marks(st, heading, lines(st, heading, 0) - 0.4);
  const sides = pickAll(root, "side");
  sides.forEach((side, i) => {
    const at = 0.22 + i * 0.14;
    tl.from(side, { opacity: 0, x: (i === 0 ? -6 : 6) * u, duration: 1.15 }, at);
    rise(st, pick(side, "sideTitle"), at + 0.25, { y: 1.5, duration: 0.8 });
    const items = pickAll(side, "sidePoint");
    tl.from(items, { opacity: 0, x: -2 * u, duration: 0.85, stagger: 0.1 }, at + 0.4);
    marks(st, side, at + 0.95 + items.length * 0.1);
  });
  const vs = pick(root, "vs");
  if (vs) tl.from(vs, { scale: 0, rotate: -120, duration: 1, ease: "back.out(1.7)" }, 0.5);
  const verdict = pick(root, "verdict");
  if (verdict) {
    const at = 1.2;
    const bar = pick(verdict, "verdictBar");
    if (bar) tl.from(bar, { scaleX: 0, duration: 0.9, ease: "deck-in-out" }, at);
    const text = pick(verdict, "verdictText");
    marks(st, text, lines(st, text, at + 0.15) - 0.4);
  }
  label(st);
}

function quote(st: Stage): void {
  const { tl, root, u } = st;
  const glyph = pick(root, "glyph");
  if (glyph) tl.from(glyph, { opacity: 0, scale: 0.3, rotate: -24, transformOrigin: "30% 70%", duration: 1.25, ease: "back.out(1.5)" }, 0);
  const text = pick(root, "quote");
  const end = words(st, text, 0.22);
  marks(st, text, end - 0.35);
  const rule = pick(root, "authorRule");
  if (rule) tl.from(rule, { scaleX: 0, duration: 0.9, ease: "deck-in-out" }, end - 0.4);
  const author = pick(root, "author");
  if (author) tl.from(author, { opacity: 0, x: -2 * u, duration: 0.9 }, end - 0.25);
  label(st);
}

function code(st: Stage, slide: SlideOf<"code">): void {
  const { tl, root, u } = st;
  const heading = pick(root, "title");
  if (heading) marks(st, heading, lines(st, heading, 0) - 0.4);
  const win = pick(root, "window");
  if (win) tl.from(win, { opacity: 0, y: 4 * u, scale: 0.985, duration: 1.1 }, 0.12);

  // Typing: each line wipes in at a steady pace, a few characters at a time.
  const texts = pickAll(root, "lineText");
  const lengths = texts.map((t) => Math.max(1, (t.textContent ?? "").replace(/​/g, "").length));
  const total = lengths.reduce((sum, n) => sum + n, 0);
  const perChar = Math.min(0.024, 2.3 / total);
  let t = 0.5;
  texts.forEach((text, i) => {
    const d = Math.max(0.05, lengths[i] * perChar);
    tl.fromTo(
      text,
      { clipPath: "inset(0% 100% 0% 0%)" },
      { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: `steps(${Math.max(1, Math.ceil(lengths[i] / 2))})` },
      t,
    );
    t += d * 0.92;
  });
  label(st);

  // Each highlight: the band glides to its lines, the rest dims, its note takes over.
  const body = pick(root, "codeBody");
  const band = pick(root, "band");
  const rows = pickAll(root, "line");
  const notes = pickAll(root, "note");
  (slide.highlights ?? []).forEach((h, i) => {
    const first = rows[h.from - 1];
    const last = rows[(h.to ?? h.from) - 1];
    const at = tl.duration();
    if (body && band && first && last) {
      const top = first.offsetTop;
      const height = last.offsetTop + last.offsetHeight - top;
      if (i === 0) {
        tl.fromTo(band, { opacity: 0, y: top, height, scaleX: 0.94, transformOrigin: "0% 50%" }, { opacity: 1, scaleX: 1, duration: 0.6 }, at);
      } else {
        tl.to(band, { y: top, height, duration: 0.7, ease: "deck-in-out" }, at);
      }
      rows.forEach((row, n) => {
        const inside = n + 1 >= h.from && n + 1 <= (h.to ?? h.from);
        tl.to(row, { opacity: inside ? 1 : 0.3, duration: 0.5, ease: "power2.out" }, at);
      });
    }
    // Each highlight has its panel beside the code (which lines, and the note): it takes over from the last.
    const previous = notes[i - 1];
    if (previous) tl.to(previous, { opacity: 0, y: -1.6 * u, duration: 0.35, ease: "power2.in" }, at);
    const note = notes[i];
    if (note) tl.fromTo(note, { opacity: 0, y: 2.4 * u }, { opacity: 1, y: 0, duration: 0.8 }, at + 0.18);
    label(st);
  });
}

function image(st: Stage): void {
  const { tl, root } = st;
  const frame = pick(root, "frame");
  const img = pick(root, "img");
  const full = frame?.dataset.full === "true";
  if (frame && !full) {
    tl.fromTo(frame, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.5, ease: "deck-in-out" }, 0);
  }
  if (img) tl.from(img, { scale: full ? 1.28 : 1.4, opacity: full ? 0 : 1, duration: 2.3 }, 0);
  const scrim = pick(root, "scrim");
  if (scrim) tl.from(scrim, { opacity: 0, duration: 1.2 }, 0.4);
  const heading = pick(root, "title");
  const end = lines(st, heading, full ? 0.7 : 0.5);
  marks(st, heading, end - 0.4);
  rise(st, pick(root, "caption"), full ? 1.05 : 0.9, { y: 2 });
  label(st);
}

function diagram(st: Stage, slide: SlideOf<"diagram">): void {
  const { tl, root, u } = st;
  const area = pick(root, "diagram");
  if (area) layoutDiagram(area);
  const heading = pick(root, "title");
  if (heading) marks(st, heading, lines(st, heading, 0) - 0.4);
  if (!area) {
    label(st);
    return;
  }
  const nodes = Array.from(area.querySelectorAll<HTMLElement>(":scope > [data-node]"));
  const groups = Array.from(area.querySelectorAll<SVGGElement>("[data-edge]"));
  const labels = Array.from(area.querySelectorAll<HTMLElement>(":scope > [data-edge-label]"));
  const n = nodes.length;
  const cycle = slide.layout === "cycle";
  const hub = slide.layout === "hub";
  // In a cycle, the arrow back into the first node closes the loop at the very end.
  const closing = cycle ? groups.find((g) => Number(g.dataset.to) === 0) : undefined;
  const into = (i: number) => groups.filter((g) => Number(g.dataset.to) === i && g !== closing);

  const draw = (group: SVGGElement, at: number) => {
    const line = group.querySelector<SVGPathElement>("[data-k='edgeLine']");
    const head = group.querySelector<SVGPathElement>("[data-k='edgeHead']");
    if (line) tl.fromTo(line, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 0.62, ease: "deck-in-out" }, at);
    if (head) tl.from(head, { opacity: 0, scale: 0, transformOrigin: "50% 50%", duration: 0.36, ease: "back.out(2.2)" }, at + 0.46);
    const tag = labels.find((l) => l.dataset.edgeLabel === group.dataset.edge);
    if (tag) tl.from(tag, { opacity: 0, scale: 0.8, duration: 0.5 }, at + 0.32);
  };
  const reveal = (i: number, at: number) => {
    const incoming = into(i);
    incoming.forEach((g) => draw(g, at));
    const node = nodes[i];
    if (node) {
      tl.from(
        node,
        { opacity: 0, scale: hub && i === 0 ? 0.55 : 0.74, y: 1.6 * u, duration: 0.9, ease: "back.out(1.45)" },
        at + (incoming.length > 0 ? 0.42 : 0),
      );
    }
  };

  const start = heading ? 0.35 : 0.1;
  if (!slide.build) {
    let t = start;
    for (let i = 0; i < n; i++) {
      reveal(i, t);
      t += into(i).length > 0 ? 0.5 : 0.3;
    }
    if (closing) draw(closing, t);
    label(st);
    return;
  }
  reveal(0, start);
  label(st);
  for (let i = 1; i < n; i++) {
    const at = tl.duration();
    reveal(i, at);
    if (i === n - 1 && closing) draw(closing, at + 0.6);
    label(st);
  }
}

function closing(st: Stage): void {
  const { tl, root, u } = st;
  const heading = pick(root, "title");
  const end = lines(st, heading, 0, { duration: 1.25 });
  marks(st, heading, end - 0.45);
  pickAll(root, "check").forEach((item, i) => {
    const at = 0.5 + i * 0.18;
    const tick = pick(item, "tick");
    if (tick) tl.from(tick, { scale: 0, duration: 0.6, ease: "back.out(2)" }, at);
    const path = item.querySelector<SVGPathElement>("[data-k='tickPath']");
    if (path) tl.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.5, ease: "deck-in-out" }, at + 0.2);
    const text = pick(item, "checkText");
    marks(st, text, lines(st, text, at + 0.1, { duration: 1 }) - 0.4);
  });
  const next = pick(root, "next");
  if (next) tl.from(next, { opacity: 0, y: 3 * u, duration: 1.1 }, Math.max(0.9, tl.duration() - 0.6));
  label(st);
}
