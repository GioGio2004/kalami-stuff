import { selectAll } from "css-select";
import { parse as parseSelector, SelectorType, type Selector } from "css-what";
import { isTag, type AnyNode, type Document, type Element } from "domhandler";
import { findAll, textContent } from "domutils";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { mediaMatches, parseDeclarations, parseStylesheet, type Declaration } from "./css";
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

const USER_AGENT_RULES = parseStylesheet(USER_AGENT_CSS);

type Specificity = [number, number, number];

type Candidate = {
  property: string;
  value: string;
  /** 0 = browser default, 1 = the student's CSS, 2 = the student's !important. */
  level: number;
  inline: boolean;
  specificity: Specificity;
  order: number;
  media: string[];
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
        if (token.name === "id" && token.action === "equals") result[0]++;
        else result[1]++;
        break;
      case SelectorType.Pseudo: {
        if (token.name === "where") break;
        if (Array.isArray(token.data) && ["not", "is", "matches", "has"].includes(token.name)) {
          const inner = maxSpecificity(token.data.map(specificity));
          result[0] += inner[0];
          result[1] += inner[1];
          result[2] += inner[2];
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

const TRAVERSALS = new Set<string>([
  SelectorType.Adjacent,
  SelectorType.Child,
  SelectorType.Descendant,
  SelectorType.Parent,
  SelectorType.Sibling,
  SelectorType.ColumnCombinator,
]);

/**
 * Parses a selector list the way a browser does. css-what also accepts
 * relative selectors like `> li` or `nav >`, which browsers reject.
 */
function parseStrict(selector: string): Selector[][] {
  const parsed = parseSelector(selector);
  if (parsed.length === 0) {
    throw new Error("The selector is empty.");
  }
  for (const tokens of parsed) {
    if (tokens.length === 0 || TRAVERSALS.has(tokens[0].type) || TRAVERSALS.has(tokens[tokens.length - 1].type)) {
      throw new Error(`\`${selector}\` starts or ends with a combinator.`);
    }
  }
  return parsed;
}

/** Null when the selector is fine; otherwise why a browser would reject it. */
export function selectorError(selector: string): string | null {
  try {
    parseStrict(selector);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The selector is not valid.";
  }
}

function normalizeHref(href: string): string {
  return href.trim().replace(/^\.\//, "").replace(/[?#].*$/, "");
}

function beats(a: Candidate, b: Candidate): boolean {
  if (a.level !== b.level) return a.level > b.level;
  if (a.inline !== b.inline) return a.inline;
  const s = compare(a.specificity, b.specificity);
  if (s !== 0) return s > 0;
  return a.order > b.order;
}

function parentElement(element: Element): Element | null {
  const parent = element.parent;
  return parent !== null && isTag(parent as AnyNode) ? (parent as Element) : null;
}

/**
 * Work budget. A student's page is a few hundred elements and rules; these caps
 * are far above that, and keep one hostile 50 KB file from stalling grading.
 */
export const MAX_ELEMENTS = 4000;
export const MAX_RULES = 1500;
const MAX_CANDIDATES = 200_000;

export class Page {
  readonly document: Document;
  /** Set when the page is over budget: every check fails with this explanation. */
  readonly tooLarge: string | null = null;
  private readonly files: Map<string, string>;
  private readonly candidates = new Map<Element, Candidate[]>();
  private candidateCount = 0;
  private order = 0;

  constructor(files: CodeFile[], entry = "index.html") {
    this.files = new Map(files.map((file) => [file.name, file.content]));
    this.document = parse(this.files.get(entry) ?? "", {
      treeAdapter: adapter,
      sourceCodeLocationInfo: true,
    }) as unknown as Document;
    const elements = this.elements();
    if (elements.length > MAX_ELEMENTS) {
      this.tooLarge = `The page has more than ${MAX_ELEMENTS} elements, which is too many to check.`;
      return;
    }
    const rules = this.stylesheets().flatMap((css) => parseStylesheet(css));
    if (rules.length > MAX_RULES) {
      this.tooLarge = `The CSS has more than ${MAX_RULES} rules, which is too many to check.`;
      return;
    }
    for (const rule of USER_AGENT_RULES) {
      this.applyRule(rule.selector, rule.declarations, rule.media, 0);
    }
    for (const rule of rules) {
      this.applyRule(rule.selector, rule.declarations, rule.media, 1);
      if (this.candidateCount > MAX_CANDIDATES) {
        this.tooLarge = "The CSS applies too many declarations to check.";
        return;
      }
    }
    for (const element of elements) {
      const style = element.attribs.style;
      if (style !== undefined) {
        this.addDeclarations(element, parseDeclarations(style), 1, true, [0, 0, 0], []);
      }
    }
  }

  /** Every element, in document order. */
  elements(): Element[] {
    return findAll(() => true, this.document.children);
  }

  /** The `href`s of `<link rel="stylesheet">` elements, normalised. */
  linkedStylesheets(): string[] {
    return this.elements()
      .filter((el) => el.name === "link" && /(^|\s)stylesheet(\s|$)/i.test(el.attribs.rel ?? ""))
      .map((el) => normalizeHref(el.attribs.href ?? ""));
  }

  /** Elements matching a CSS selector. Throws on a selector a browser would reject. */
  select(selector: string): Element[] {
    return selectAll<AnyNode, Element>(parseStrict(selector), this.document);
  }

  text(element: Element): string {
    return textContent(element).replace(/\s+/g, " ").trim();
  }

  /** The value `property` ends up with on `element`, on a screen `viewport` px wide. */
  computed(element: Element, property: string, viewport: number): string | null {
    let best: Candidate | null = null;
    for (const candidate of this.candidates.get(element) ?? []) {
      if (
        candidate.property === property &&
        (best === null || beats(candidate, best)) &&
        mediaMatches(candidate.media, viewport)
      ) {
        best = candidate;
      }
    }
    const value = best?.value ?? null;
    const inherits = value === "inherit" || ((value === null || value === "unset") && INHERITED.has(property));
    if (inherits) {
      const parent = parentElement(element);
      return parent === null ? (INITIAL[property] ?? null) : this.computed(parent, property, viewport);
    }
    if (value === null || value === "initial" || value === "unset") {
      return INITIAL[property] ?? null;
    }
    return value;
  }

  /** CSS from `<style>` and linked files, in document order. */
  private stylesheets(): string[] {
    const sheets: string[] = [];
    for (const element of this.elements()) {
      if (element.name === "style") {
        sheets.push(textContent(element));
      } else if (element.name === "link" && /(^|\s)stylesheet(\s|$)/i.test(element.attribs.rel ?? "")) {
        const css = this.files.get(normalizeHref(element.attribs.href ?? ""));
        if (css !== undefined) {
          sheets.push(css);
        }
      }
    }
    return sheets;
  }

  private applyRule(selectorText: string, declarations: Declaration[], media: string[], level: number) {
    let selectors: Selector[][];
    try {
      selectors = parseStrict(selectorText);
    } catch {
      // One bad selector drops the whole rule, as in browsers.
      return;
    }
    const matched = new Map<Element, Specificity>();
    for (const selector of selectors) {
      let elements: Element[];
      try {
        elements = selectAll<AnyNode, Element>([selector], this.document);
      } catch {
        // :hover, ::before and friends never match a page at rest.
        continue;
      }
      const s = specificity(selector);
      for (const element of elements) {
        const previous = matched.get(element);
        matched.set(element, previous === undefined ? s : maxSpecificity([previous, s]));
      }
    }
    for (const [element, s] of matched) {
      this.addDeclarations(element, declarations, level, false, s, media);
    }
  }

  private addDeclarations(
    element: Element,
    declarations: Declaration[],
    level: number,
    inline: boolean,
    s: Specificity,
    media: string[],
  ) {
    let list = this.candidates.get(element);
    if (list === undefined) {
      list = [];
      this.candidates.set(element, list);
    }
    for (const declaration of declarations) {
      if (!isValidDeclaration(declaration.property, declaration.value)) {
        continue;
      }
      const longhands = expand(declaration.property, declaration.value);
      if (longhands === null) {
        continue;
      }
      const order = this.order++;
      const entries = longhands.some((l) => l.property === declaration.property)
        ? longhands
        : [{ property: declaration.property, value: declaration.value.trim().toLowerCase() }, ...longhands];
      this.candidateCount += entries.length;
      for (const { property, value } of entries) {
        list.push({
          property,
          value,
          level: level === 1 && declaration.important ? 2 : level,
          inline,
          specificity: s,
          order,
          media,
        });
      }
    }
  }
}
