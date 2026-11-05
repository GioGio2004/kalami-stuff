import { SelectorType, type Selector } from "css-what";
import { isTag, type AnyNode, type Document, type Element } from "domhandler";
import { findAll } from "domutils";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { mediaMatches, parseDeclarations, parseStylesheetFull, type Declaration, type Keyframes } from "./css";
import {
  compileSelector,
  Matcher,
  parentOf,
  TooMuchWork,
  type CompiledSelector,
  type States,
} from "./match";
import type { CodeFile } from "./types";
import { expand, INHERITED, INITIAL, isValidDeclaration } from "./values";

/**
 * A student's page as the browser would see it: the HTML tree (parse5 builds
 * the same tree a browser does, mistakes included) and, for any element, the
 * value each CSS property ends up with after the cascade.
 */

/** The browser's own defaults that checks can notice (links are underlined, lists have bullets…). */
const USER_AGENT_CSS = `
html, body, div, section, article, aside, nav, header, footer, main, p, h1, h2, h3, h4, h5, h6,
ul, ol, form, figure, figcaption, blockquote, address, fieldset, hr, pre, dl, dd, dt, details,
summary, legend { display: block; }
li { display: list-item; }
head, script, style, link, meta, title, template, noscript { display: none; }
[hidden] { display: none; }
table { display: table; } tr { display: table-row; } td, th { display: table-cell; }
thead { display: table-header-group; } tbody { display: table-row-group; } tfoot { display: table-footer-group; }
button, input, select, textarea { display: inline-block; }
body { margin: 8px; }
p, ul, ol, blockquote, figure, dl { margin-top: 1em; margin-bottom: 1em; }
h1 { font-size: 2em; margin-top: 0.67em; margin-bottom: 0.67em; font-weight: bold; }
h2 { font-size: 1.5em; margin-top: 0.83em; margin-bottom: 0.83em; font-weight: bold; }
h3 { font-size: 1.17em; margin-top: 1em; margin-bottom: 1em; font-weight: bold; }
h4 { margin-top: 1.33em; margin-bottom: 1.33em; font-weight: bold; }
h5 { font-size: 0.83em; margin-top: 1.67em; margin-bottom: 1.67em; font-weight: bold; }
h6 { font-size: 0.67em; margin-top: 2.33em; margin-bottom: 2.33em; font-weight: bold; }
ul, ol { padding-left: 40px; }
ul { list-style-type: disc; } ol { list-style-type: decimal; }
a { color: #0000ee; text-decoration: underline; cursor: pointer; }
strong, b, th { font-weight: bold; }
em, i { font-style: italic; }
`;

type Specificity = [number, number, number];

/** One longhand of one declaration, ready for the cascade. */
type Entry = {
  property: string;
  value: string;
  important: boolean;
  order: number;
  /** Set when the value uses var(): the declaration as written, expanded again once vars are known. */
  source?: { property: string; value: string };
};

type Candidate = Entry & {
  /** 0 = browser default, 1 = the student's CSS, 2 = the student's !important. */
  level: number;
  inline: boolean;
  /** @layer position; undefined (outside layers) beats every layer. */
  layer?: number;
  specificity: Specificity;
  media: string[];
};

type LoadedRule = {
  selectors: CompiledSelector[];
  specificities: Specificity[];
  entries: Entry[];
  media: string[];
  layer?: number;
  level: number;
};

function maxSpecificity(list: Specificity[]): Specificity {
  return list.reduce<Specificity>((best, s) => (compare(s, best) > 0 ? s : best), [0, 0, 0]);
}

function compare(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function specificity(selector: Selector[]): Specificity {
  const result: Specificity = [0, 0, 0];
  for (const token of selector) {
    switch (token.type) {
      case SelectorType.Attribute:
        // Only `#x` is an id selector; `[id=x]` counts like any attribute.
        if (token.name === "id" && token.action === "equals" && token.ignoreCase === "quirks") result[0]++;
        else result[1]++;
        break;
      case SelectorType.Pseudo: {
        if (token.name === "where") break;
        if (Array.isArray(token.data) && ["not", "is", "matches", "has"].includes(token.name)) {
          const inner = maxSpecificity(token.data.map(specificity));
          result[0] += inner[0];
          result[1] += inner[1];
          result[2] += inner[2];
        } else if (["before", "after", "first-line", "first-letter"].includes(token.name) && token.data === null) {
          result[2]++;
        } else {
          result[1]++;
        }
        break;
      }
      case SelectorType.Tag:
      case SelectorType.PseudoElement:
        result[2]++;
        break;
      default:
        break;
    }
  }
  return result;
}

/**
 * Null when the selector is fine; otherwise why a browser would reject it.
 * `states: false` also refuses `:hover`, `::before` and friends, which only
 * CSS checks understand.
 */
export function selectorError(selector: string, { states = true }: { states?: boolean } = {}): string | null {
  try {
    const compiled = compileSelector(selector);
    if (!states && compiled.some((c) => c.conditional)) {
      return `\`${selector}\` uses a state like :hover or a pseudo-element like ::before. Only CSS checks can use those.`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The selector is not valid.";
  }
}

/** `./style.css`, `/style.css` and `style.css?v=2` are all the file `style.css`. */
export function normalizeHref(href: string): string {
  return href.trim().replace(/^\.?\//, "").replace(/[?#].*$/, "");
}

function beats(a: Candidate, b: Candidate): boolean {
  if (a.level !== b.level) return a.level > b.level;
  if (a.inline !== b.inline) return a.inline;
  if (a.level > 0 && a.layer !== b.layer) {
    // Unlayered rules beat layered ones and later layers beat earlier ones; !important turns that around.
    const rank = (c: Candidate) => c.layer ?? Number.POSITIVE_INFINITY;
    return a.level === 2 ? rank(a) < rank(b) : rank(a) > rank(b);
  }
  const s = compare(a.specificity, b.specificity);
  if (s !== 0) return s > 0;
  return a.order > b.order;
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol",
  "p", "pre", "section", "summary", "table", "td", "th", "tr", "ul",
]);
const NO_TEXT = new Set(["script", "style", "template", "noscript", "head"]);

/** Text the way a reader sees it: `<br>` and block edges are breaks, <style> and <script> aren't text. */
function readableText(node: AnyNode, out: string[]) {
  if (node.type === "text") {
    out.push((node as unknown as { data: string }).data);
    return;
  }
  if (!isTag(node)) return;
  if (NO_TEXT.has(node.name)) return;
  if (node.name === "br") {
    out.push(" ");
    return;
  }
  const block = BLOCK_TAGS.has(node.name);
  if (block) out.push(" ");
  for (const child of node.children) readableText(child as AnyNode, out);
  if (block) out.push(" ");
}

/**
 * Work budget. A student's page is a few hundred elements and rules; these caps
 * are far above that, and keep one hostile 50 KB file from stalling grading.
 * The selector budget counts compound tests, not time, so every computer and
 * the server agree on whether a page is too big.
 */
export const MAX_ELEMENTS = 4000;
export const MAX_RULES = 1500;
const MAX_CANDIDATES = 200_000;
export const MAX_SELECTOR_WORK = 600_000;
const MAX_IMPORT_DEPTH = 4;
const MAX_VAR_DEPTH = 12;

const USER_AGENT_SHEET = parseStylesheetFull(USER_AGENT_CSS).rules;

export type Context = {
  /** Which elements are hovered, focused…; none at rest. */
  states?: States;
  /** Styles of this pseudo-element of the element, e.g. "before". */
  pseudoElement?: string;
};

export class Page {
  readonly document: Document;
  /** Set when the page is over budget: every check fails with this explanation. */
  readonly tooLarge: string | null = null;
  readonly quirks: boolean;
  private readonly files: Map<string, string>;
  private readonly all: Element[];
  private readonly position = new Map<Element, number>();
  private readonly byId = new Map<string, Element[]>();
  private readonly byClass = new Map<string, Element[]>();
  private readonly byTag = new Map<string, Element[]>();
  private readonly candidates = new Map<Element, Candidate[]>();
  /** Rules that only apply in a state (:hover) or to a pseudo-element (::before). */
  private readonly conditional: LoadedRule[] = [];
  private readonly matcher = new Matcher(MAX_SELECTOR_WORK);
  private readonly frames: Keyframes[] = [];
  private candidateCount = 0;
  private order = 0;

  constructor(files: CodeFile[], entry = "index.html") {
    this.files = new Map(files.map((file) => [normalizeHref(file.name), file.content]));
    this.document = parse(this.files.get(entry) ?? "", {
      treeAdapter: adapter,
      sourceCodeLocationInfo: true,
    }) as unknown as Document;
    this.quirks = (this.document as unknown as Record<string, unknown>)["x-mode"] === "quirks";
    this.all = findAll(() => true, this.document.children);
    if (this.all.length > MAX_ELEMENTS) {
      this.tooLarge = `The page has more than ${MAX_ELEMENTS} elements, which is too many to check.`;
      return;
    }
    this.index();
    try {
      const rules: LoadedRule[] = [];
      for (const rule of USER_AGENT_SHEET) {
        const loaded = this.load(rule.selector, rule.declarations, rule.media, undefined, 0);
        if (loaded !== null) rules.push(loaded);
      }
      const authored = this.authorRules();
      if (authored === null) {
        this.tooLarge = `The CSS has more than ${MAX_RULES} rules, which is too many to check.`;
        return;
      }
      rules.push(...authored);
      for (const rule of rules) {
        this.apply(rule);
        if (this.candidateCount > MAX_CANDIDATES) {
          this.tooLarge = "The CSS applies too many declarations to check.";
          return;
        }
      }
      for (const element of this.all) {
        const style = element.attribs.style;
        if (style !== undefined) {
          this.push(element, this.entries(parseDeclarations(style)), 1, true, [0, 0, 0], [], undefined);
        }
      }
    } catch (error) {
      if (!(error instanceof TooMuchWork)) throw error;
      this.tooLarge = error.message;
    }
  }

  /** Every element, in document order. */
  elements(): Element[] {
    return this.all;
  }

  /** The `href`s of `<link rel="stylesheet">` elements, normalised. */
  linkedStylesheets(): string[] {
    return this.all
      .filter((el) => el.name === "link" && /(^|\s)stylesheet(\s|$)/i.test(el.attribs.rel ?? ""))
      .map((el) => normalizeHref(el.attribs.href ?? ""));
  }

  /**
   * Elements matching a CSS selector, in document order. Throws on a selector
   * a browser would reject, and on states and pseudo-elements (use `selectInStates`).
   */
  select(selector: string): Element[] {
    const compiled = compileSelector(selector, this.quirks);
    if (compiled.some((c) => c.conditional)) {
      throw new Error("Only CSS checks can use :hover, :focus or ::before.");
    }
    return this.union(compiled.map((c) => this.candidatesFor(c).filter((el) => this.matcher.matches(c, el))));
  }

  /**
   * Elements a CSS check looks at, with the states the selector puts them in:
   * `.card:hover .title` gives each `.title` inside a `.card`, with that card hovered.
   */
  selectInStates(selector: string): { element: Element; context: Context }[] {
    const out = new Map<Element, Context>();
    for (const compiled of compileSelector(selector, this.quirks)) {
      for (const element of this.candidatesFor(compiled)) {
        if (out.has(element)) continue;
        if (!compiled.conditional) {
          if (this.matcher.matches(compiled, element)) out.set(element, {});
          continue;
        }
        const states = this.matcher.assume(compiled, element);
        if (states !== null) {
          out.set(element, {
            ...(states.size > 0 ? { states } : {}),
            ...(compiled.pseudoElement !== null ? { pseudoElement: compiled.pseudoElement } : {}),
          });
        }
      }
    }
    return [...out]
      .sort(([a], [b]) => this.position.get(a)! - this.position.get(b)!)
      .map(([element, context]) => ({ element, context }));
  }

  text(element: Element): string {
    const out: string[] = [];
    readableText(element, out);
    return out.join("").replace(/\s+/g, " ").trim();
  }

  /** The @keyframes in effect on a screen `viewport` px wide, by lower-case name. */
  keyframes(viewport: number): Map<string, Keyframes> {
    const out = new Map<string, Keyframes>();
    for (const frames of this.frames) {
      if (mediaMatches(frames.media, viewport)) out.set(frames.name, frames);
    }
    return out;
  }

  /** The value `property` ends up with on `element`, on a screen `viewport` px wide. */
  computed(element: Element, property: string, viewport: number, context: Context = {}, depth = 0): string | null {
    const best = this.winner(element, property, viewport, context);
    let value = best === null ? null : this.resolve(best, element, property, viewport, context, depth);
    const custom = property.startsWith("--");
    const inherits =
      value === "inherit" || ((value === null || value === "unset") && (custom || INHERITED.has(property)));
    if (inherits) {
      // A pseudo-element inherits from its element; an element from its parent.
      const parent = context.pseudoElement !== undefined ? element : parentOf(element);
      const parentContext = context.pseudoElement !== undefined ? { states: context.states } : context;
      return parent === null ? (INITIAL[property] ?? null) : this.computed(parent, property, viewport, parentContext, depth);
    }
    if (value === null || value === "initial" || value === "unset") {
      value = INITIAL[property] ?? null;
    }
    // A border or outline with no style has no width.
    const side = /^(border-(?:top|right|bottom|left)|outline)-width$/.exec(property);
    if (side !== null && value !== null) {
      const style = this.computed(element, `${side[1]}-style`, viewport, context, depth);
      if (style === "none" || style === "hidden") return "0";
    }
    return value;
  }

  private index() {
    const add = (map: Map<string, Element[]>, key: string, element: Element) => {
      const list = map.get(key);
      if (list === undefined) map.set(key, [element]);
      else list.push(element);
    };
    this.all.forEach((element, i) => {
      this.position.set(element, i);
      add(this.byTag, element.name, element);
      const id = element.attribs.id;
      if (id !== undefined && id !== "") add(this.byId, id, element);
      for (const name of (element.attribs.class ?? "").split(/[ \t\n\f\r]+/)) {
        if (name !== "") add(this.byClass, name, element);
      }
    });
  }

  /** The elements that could match: the subject's id, class or tag narrows them down. */
  private candidatesFor(selector: CompiledSelector): Element[] {
    const key = selector.key;
    if (key === null) return this.all;
    const map = key.kind === "id" ? this.byId : key.kind === "class" ? this.byClass : this.byTag;
    return map.get(key.value) ?? [];
  }

  private union(lists: Element[][]): Element[] {
    if (lists.length === 1) return lists[0];
    const seen = new Set(lists.flat());
    return [...seen].sort((a, b) => this.position.get(a)! - this.position.get(b)!);
  }

  /** CSS from `<style>`, linked files and their @imports, in cascade order. Null when there is too much. */
  private authorRules(): LoadedRule[] | null {
    const rules: LoadedRule[] = [];
    const layerOffset = { next: 0 };
    const load = (css: string, media: string[], depth: number, seen: Set<string>): boolean => {
      const sheet = parseStylesheetFull(css);
      for (const imported of sheet.imports) {
        const href = normalizeHref(imported.href);
        const content = this.files.get(href);
        if (content === undefined || seen.has(href) || depth >= MAX_IMPORT_DEPTH) continue;
        if (!load(content, [...media, ...imported.media], depth + 1, new Set([...seen, href]))) return false;
      }
      // Layer numbers are per file; shift them so files don't share positions.
      const base = layerOffset.next;
      let maxLayer = -1;
      for (const rule of sheet.rules) {
        const layer = rule.layer === undefined ? undefined : base + rule.layer;
        if (rule.layer !== undefined) maxLayer = Math.max(maxLayer, rule.layer);
        const loaded = this.load(rule.selector, rule.declarations, [...media, ...rule.media], layer, 1);
        if (loaded !== null) rules.push(loaded);
        if (rules.length > MAX_RULES) return false;
      }
      layerOffset.next = base + maxLayer + 1;
      for (const frames of sheet.keyframes) {
        const index = this.frames.findIndex((k) => k.name === frames.name);
        if (index !== -1) this.frames.splice(index, 1);
        this.frames.push({ ...frames, media: [...media, ...frames.media] });
      }
      return true;
    };
    for (const element of this.all) {
      const media = element.attribs.media?.trim() ? [element.attribs.media.trim()] : [];
      if (element.name === "style") {
        const css = element.children.map((child) => ("data" in child ? String(child.data) : "")).join("");
        if (!load(css, media, 0, new Set())) return null;
      } else if (element.name === "link" && /(^|\s)stylesheet(\s|$)/i.test(element.attribs.rel ?? "")) {
        const href = normalizeHref(element.attribs.href ?? "");
        const css = this.files.get(href);
        if (css !== undefined && !load(css, media, 0, new Set([href]))) return null;
      }
    }
    return rules;
  }

  /** Expands every valid declaration once, numbering them in source order. */
  private entries(declarations: Declaration[]): Entry[] {
    const out: Entry[] = [];
    for (const declaration of declarations) {
      if (!isValidDeclaration(declaration.property, declaration.value)) continue;
      const longhands = expand(declaration.property, declaration.value);
      if (longhands === null) continue;
      const order = this.order++;
      const value = declaration.value.trim().toLowerCase();
      const source = value.includes("var(") ? { property: declaration.property, value } : undefined;
      const list = longhands.some((l) => l.property === declaration.property)
        ? longhands
        : [{ property: declaration.property, value }, ...longhands];
      for (const longhand of list) {
        out.push({ ...longhand, important: declaration.important, order, ...(source ? { source } : {}) });
      }
    }
    return out;
  }

  /** A rule ready to apply; null when a browser would drop it (one bad selector drops the whole list). */
  private load(selector: string, declarations: Declaration[], media: string[], layer: number | undefined, level: number): LoadedRule | null {
    let selectors: CompiledSelector[];
    try {
      selectors = compileSelector(selector, this.quirks);
    } catch {
      return null;
    }
    return {
      selectors,
      specificities: selectors.map((s) => specificity(s.tokens)),
      entries: this.entries(declarations),
      media,
      ...(layer !== undefined ? { layer } : {}),
      level,
    };
  }

  private apply(rule: LoadedRule) {
    if (rule.entries.length === 0) return;
    const matched = new Map<Element, Specificity>();
    rule.selectors.forEach((selector, i) => {
      if (selector.conditional) return;
      for (const element of this.candidatesFor(selector)) {
        if (!this.matcher.matches(selector, element)) continue;
        const previous = matched.get(element);
        matched.set(element, previous === undefined ? rule.specificities[i] : maxSpecificity([previous, rule.specificities[i]]));
      }
    });
    if (rule.selectors.some((s) => s.conditional)) this.conditional.push(rule);
    for (const [element, s] of matched) {
      this.push(element, rule.entries, rule.level, false, s, rule.media, rule.layer);
    }
  }

  private push(
    element: Element,
    entries: Entry[],
    level: number,
    inline: boolean,
    s: Specificity,
    media: string[],
    layer: number | undefined,
  ) {
    let list = this.candidates.get(element);
    if (list === undefined) {
      list = [];
      this.candidates.set(element, list);
    }
    this.candidateCount += entries.length;
    for (const entry of entries) {
      list.push(candidate(entry, level, inline, s, media, layer));
    }
  }

  /** The declaration that wins for `property` on `element`, in `context`. */
  private winner(element: Element, property: string, viewport: number, context: Context): Candidate | null {
    let best: Candidate | null = null;
    const consider = (c: Candidate) => {
      if (c.property === property && (best === null || beats(c, best)) && mediaMatches(c.media, viewport)) best = c;
    };
    if (context.pseudoElement === undefined) {
      for (const c of this.candidates.get(element) ?? []) consider(c);
    }
    if (context.states !== undefined || context.pseudoElement !== undefined) {
      const states = context.states ?? new Map();
      for (const rule of this.conditional) {
        let s: Specificity | null = null;
        rule.selectors.forEach((selector, i) => {
          if (!selector.conditional || selector.pseudoElement !== (context.pseudoElement ?? null)) return;
          if (this.matcher.matchesIn(selector, element, states)) {
            s = s === null ? rule.specificities[i] : maxSpecificity([s, rule.specificities[i]]);
          }
        });
        if (s === null) continue;
        for (const entry of rule.entries) consider(candidate(entry, rule.level, false, s, rule.media, rule.layer));
      }
    }
    return best;
  }

  /** The winning value with var() worked out; null when that makes it invalid. */
  private resolve(best: Candidate, element: Element, property: string, viewport: number, context: Context, depth: number): string | null {
    if (best.source === undefined) return best.value;
    if (depth >= MAX_VAR_DEPTH) return null;
    const substituted = this.substitute(best.source.value, element, viewport, context, depth + 1);
    if (substituted === null || !isValidDeclaration(best.source.property, substituted)) return null;
    const longhands = expand(best.source.property, substituted);
    return longhands?.find((l) => l.property === property)?.value ?? (best.source.property === property ? substituted : null);
  }

  /** Replaces every var(--x, fallback) in `value`. Null when one is missing and has no fallback. */
  private substitute(value: string, element: Element, viewport: number, context: Context, depth: number): string | null {
    let out = "";
    let i = 0;
    while (i < value.length) {
      const at = value.indexOf("var(", i);
      if (at === -1) {
        out += value.slice(i);
        break;
      }
      out += value.slice(i, at);
      let level = 0;
      let end = at + 4;
      for (; end < value.length; end++) {
        if (value[end] === "(") level++;
        else if (value[end] === ")") {
          if (level === 0) break;
          level--;
        }
      }
      const inside = value.slice(at + 4, end);
      const comma = inside.indexOf(",");
      const name = (comma === -1 ? inside : inside.slice(0, comma)).trim();
      const fallback = comma === -1 ? null : inside.slice(comma + 1).trim();
      let replacement = name.startsWith("--") ? this.computed(element, name, viewport, context, depth) : null;
      if (replacement !== null && replacement.includes("var(")) {
        replacement = this.substitute(replacement, element, viewport, context, depth + 1);
      }
      if (replacement === null && fallback !== null) {
        replacement = this.substitute(fallback, element, viewport, context, depth + 1);
      }
      if (replacement === null || depth > MAX_VAR_DEPTH) return null;
      out += replacement;
      i = end + 1;
    }
    return out.trim();
  }
}

function candidate(entry: Entry, level: number, inline: boolean, s: Specificity, media: string[], layer: number | undefined): Candidate {
  return {
    ...entry,
    level: level === 1 && entry.important ? 2 : level,
    inline,
    ...(layer !== undefined ? { layer } : {}),
    specificity: s,
    media,
  };
}

