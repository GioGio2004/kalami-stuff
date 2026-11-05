/**
 * A small, forgiving CSS parser. Beginners' CSS is often broken, so this
 * follows the browser's recovery rules where it matters: an unclosed comment
 * runs to the end, a rule with a broken selector is dropped, a declaration
 * missing its `;` swallows the next line. Offsets point into the original
 * source.
 *
 * It understands what beginners meet in tutorials: @media, @supports, @layer,
 * @import, @keyframes, nested rules (`.card { & p { … } }`) and the old
 * `<!-- -->` wrappers inside <style>.
 */

export type Declaration = {
  property: string;
  value: string;
  important: boolean;
  /** Offset of the property name, and just past the value. */
  start: number;
  end: number;
};

export type StyleRule = {
  /** The selector as the browser reads it; nested rules get their parent's selector worked in. */
  selector: string;
  declarations: Declaration[];
  /** Conditions of the @media blocks around the rule, outermost first. */
  media: string[];
  /** Position of the @layer the rule sits in (earlier layers lose); undefined outside layers. */
  layer?: number;
  /** True for a rule written inside another rule. */
  nested?: boolean;
  selectorStart: number;
  selectorEnd: number;
  /** Offset of the `{`, and just past the `}` (or the end of the file). */
  open: number;
  close: number;
  /** False when the file ends before the rule's `}`. */
  closed: boolean;
};

export type KeyframeBlock = {
  /** Offsets in percent: `from` is 0, `to` is 100. */
  offsets: number[];
  declarations: Declaration[];
};

export type Keyframes = {
  /** Lower case, as `animation-name` values are compared. */
  name: string;
  frames: KeyframeBlock[];
  media: string[];
};

export type StyleImport = { href: string; media: string[] };

export type Stylesheet = {
  rules: StyleRule[];
  keyframes: Keyframes[];
  /** `@import`s at the top of the file, in order. */
  imports: StyleImport[];
};

/**
 * Index of the first character from `stops` in css[from, end), skipping
 * strings and, when `parens` is set, anything inside parentheses.
 */
function scan(css: string, from: number, end: number, stops: string, parens: boolean): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < end; i++) {
    const ch = css[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (parens && ch === "(") {
      depth++;
    } else if (parens && ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && stops.includes(ch)) {
      return i;
    }
  }
  return end;
}

/** Index just past the `}` that closes the `{` at `open`, or `end` if it never closes. */
function blockEnd(css: string, open: number, end: number): number {
  let depth = 0;
  let i = open;
  while (i < end) {
    const next = scan(css, i, end, "{}", false);
    if (next >= end) {
      return end;
    }
    if (css[next] === "{") {
      depth++;
    } else if (--depth === 0) {
      return next + 1;
    }
    i = next + 1;
  }
  return end;
}

/** Custom properties keep their name as written, apart from case (`--Main` and `--main` agree here). */
const PROPERTY_NAME = /^(--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/;

/** One `property: value` piece. `start` is its offset in the whole file. */
function parseDeclaration(part: string, start: number): Declaration | null {
  const colon = part.indexOf(":");
  if (colon === -1) {
    return null;
  }
  const rawProperty = part.slice(0, colon);
  const property = rawProperty.trim().toLowerCase();
  let value = part.slice(colon + 1).trim();
  let important = false;
  const bang = /!\s*important\s*$/i.exec(value);
  if (bang !== null) {
    important = true;
    value = value.slice(0, bang.index).trim();
  }
  if (!PROPERTY_NAME.test(property) || value === "") {
    return null;
  }
  const lead = rawProperty.length - rawProperty.trimStart().length;
  return { property, value, important, start: start + lead, end: start + part.trimEnd().length };
}

/** Declarations of a block body. `base` is the body's offset in the whole file. */
export function parseDeclarations(body: string, base = 0): Declaration[] {
  const out: Declaration[] = [];
  let i = 0;
  while (i < body.length) {
    const stop = scan(body, i, body.length, ";", true);
    const declaration = parseDeclaration(body.slice(i, stop), base + i);
    if (declaration !== null) {
      out.push(declaration);
    }
    i = stop + 1;
  }
  return out;
}

/** @media inside @media inside @media…: browsers allow it; nobody needs more than this. */
const MAX_DEPTH = 8;

/** Splits on top-level commas, outside parentheses and strings. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= text.length) {
    const stop = scan(text, i, text.length, ",", true);
    out.push(text.slice(i, stop));
    i = stop + 1;
  }
  return out;
}

/** The selector a nested rule stands for: `&` is the parent, otherwise it sits inside it. */
function resolveNested(parent: string, nested: string): string {
  const parents = splitList(parent).map((s) => s.trim());
  // A single parent goes in as it is, so :hover and friends keep working; a list needs :is().
  const self = parents.length === 1 ? parents[0] : `:is(${parents.join(", ")})`;
  return splitList(nested)
    .map((part) => {
      const s = part.trim();
      if (s.includes("&")) return s.replaceAll("&", self);
      return `${self} ${s}`;
    })
    .join(", ");
}

type Context = {
  media: string[];
  layer?: number;
  /** The enclosing rule's selector, inside a style rule. */
  parent?: string;
  /** The rule being read sits inside another rule. */
  nested?: boolean;
  depth: number;
};

class Parser {
  readonly sheet: Stylesheet = { rules: [], keyframes: [], imports: [] };
  private layers: string[] = [];
  private anonymous = 0;
  private sawRule = false;

  constructor(private readonly css: string) {}

  private layerOf(name: string): number {
    const key = name.trim().toLowerCase();
    let index = this.layers.indexOf(key);
    if (index === -1) {
      this.layers.push(key);
      index = this.layers.length - 1;
    }
    return index;
  }

  /** A list of rules: the top of the file, or the body of @media and friends. */
  rules(start: number, end: number, ctx: Context) {
    if (ctx.depth > MAX_DEPTH) return;
    const { css } = this;
    let i = start;
    while (i < end) {
      while (i < end && /\s/.test(css[i])) i++;
      if (i >= end) return;
      // At-rules end at `;` (like @import) or own a block. A normal rule's
      // selector runs to its `{`, even across a stray `;`, as in browsers.
      const isAtRule = css[i] === "@";
      const stop = scan(css, i, end, isAtRule ? "{;" : "{", false);
      if (stop >= end && !isAtRule) return;
      const raw = css.slice(i, stop);
      const prelude = raw.trim();
      if (stop >= end || css[stop] === ";") {
        if (isAtRule) this.statement(prelude, ctx);
        i = stop + 1;
        continue;
      }
      const close = blockEnd(css, stop, end);
      if (isAtRule) {
        this.atRule(prelude, stop, close, ctx);
      } else if (prelude !== "") {
        this.styleRule(prelude, i + (raw.length - raw.trimStart().length), stop, close, ctx);
      }
      i = close;
    }
  }

  /** `@import …;` and `@layer a, b;` */
  private statement(prelude: string, ctx: Context) {
    const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
    const rest = prelude.replace(/^@[\w-]+/, "").trim();
    if (name === "layer") {
      for (const layer of splitList(rest)) if (layer.trim() !== "") this.layerOf(layer);
    } else if (name === "import" && ctx.parent === undefined && ctx.depth === 0 && !this.sawRule) {
      const m = /^(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?\s*(.*)$/i.exec(rest);
      if (m !== null) {
        const media = m[3].replace(/\blayer(\([^)]*\))?/i, "").replace(/\bsupports\([^)]*\)/i, "").trim();
        this.sheet.imports.push({ href: m[2], media: media === "" ? ctx.media : [...ctx.media, media] });
      }
    }
  }

  private atRule(prelude: string, open: number, close: number, ctx: Context) {
    const { css } = this;
    const closed = css[close - 1] === "}";
    const bodyEnd = closed ? close - 1 : close;
    const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
    const rest = prelude.replace(/^@[\w-]+/, "").trim();
    const inner = { ...ctx, depth: ctx.depth + 1 };
    const body = (next: Context) =>
      next.parent === undefined
        ? this.rules(open + 1, bodyEnd, next)
        : this.block(next.parent, open + 1, bodyEnd, open, close, closed, -1, -1, next);
    switch (name) {
      case "media":
        body({ ...inner, media: [...ctx.media, rest] });
        return;
      case "supports":
        // Every browser in use supports what beginners test for; `not (…)` reads as false.
        if (!/^not\b/i.test(rest)) body(inner);
        return;
      case "layer":
        body({ ...inner, layer: this.layerOf(rest === "" ? `#anonymous${this.anonymous++}` : rest) });
        return;
      case "keyframes":
      case "-webkit-keyframes":
        if (ctx.parent === undefined) this.keyframes(rest, open + 1, bodyEnd, ctx);
        return;
      default:
        // @font-face, @page, @container…: nothing checks look at.
        return;
    }
  }

  private keyframes(rawName: string, start: number, end: number, ctx: Context) {
    const name = rawName.replace(/^["']|["']$/g, "").trim().toLowerCase();
    if (name === "") return;
    const { css } = this;
    const frames: KeyframeBlock[] = [];
    let i = start;
    while (i < end) {
      const stop = scan(css, i, end, "{", false);
      if (stop >= end) break;
      const close = blockEnd(css, stop, end);
      const bodyEnd = css[close - 1] === "}" ? close - 1 : close;
      const offsets = splitList(css.slice(i, stop)).flatMap((part) => {
        const s = part.trim().toLowerCase();
        if (s === "from") return [0];
        if (s === "to") return [100];
        const m = /^(\d*\.?\d+)%$/.exec(s);
        return m === null ? [] : [Number(m[1])];
      });
      if (offsets.length > 0) {
        frames.push({ offsets, declarations: parseDeclarations(css.slice(stop + 1, bodyEnd), stop + 1) });
      }
      i = close;
    }
    // A later @keyframes with the same name replaces an earlier one.
    this.sheet.keyframes = this.sheet.keyframes.filter((k) => k.name !== name);
    this.sheet.keyframes.push({ name, frames, media: ctx.media });
  }

  private styleRule(prelude: string, selectorStart: number, open: number, close: number, ctx: Context) {
    this.sawRule = true;
    const closed = this.css[close - 1] === "}";
    const bodyEnd = closed ? close - 1 : close;
    const selector = ctx.parent === undefined ? prelude : resolveNested(ctx.parent, prelude);
    this.block(selector, open + 1, bodyEnd, open, close, closed, selectorStart, selectorStart + prelude.length, {
      ...ctx,
      parent: selector,
      nested: ctx.parent !== undefined,
      depth: ctx.depth + 1,
    });
  }

  /**
   * A style rule's body: declarations, plus any nested rules and at-rules.
   * `selectorStart` is -1 for the declarations straight inside a nested @media.
   */
  private block(
    selector: string,
    start: number,
    end: number,
    open: number,
    close: number,
    closed: boolean,
    selectorStart: number,
    selectorEnd: number,
    ctx: Context,
  ) {
    const { css } = this;
    const declarations: Declaration[] = [];
    const rule: StyleRule = {
      selector,
      declarations,
      media: ctx.media,
      ...(ctx.layer !== undefined ? { layer: ctx.layer } : {}),
      ...(ctx.nested || selectorStart === -1 ? { nested: true } : {}),
      selectorStart: selectorStart === -1 ? open : selectorStart,
      selectorEnd: selectorStart === -1 ? open : selectorEnd,
      open,
      close,
      closed,
    };
    // The rule goes first, so nested rules after it win ties, as in browsers.
    this.sheet.rules.push(rule);
    let i = start;
    while (i < end) {
      const stop = scan(css, i, end, ";{", true);
      if (stop < end && css[stop] === "{") {
        // A nested rule or at-rule: its prelude runs from the last `;` to here.
        const raw = css.slice(i, stop);
        const prelude = raw.trim();
        const nestedClose = blockEnd(css, stop, end);
        if (prelude.startsWith("@")) {
          this.atRule(prelude, stop, nestedClose, { ...ctx, parent: selector });
        } else if (prelude !== "" && ctx.depth <= MAX_DEPTH) {
          this.styleRule(prelude, i + (raw.length - raw.trimStart().length), stop, nestedClose, { ...ctx, parent: selector });
        }
        i = nestedClose;
        continue;
      }
      const declaration = parseDeclaration(css.slice(i, stop), i);
      if (declaration !== null) {
        declarations.push(declaration);
      }
      i = stop + 1;
    }
  }
}

/** Comments become spaces of the same length (newlines kept), so offsets stay true. */
export function blankComments(source: string): string {
  // An unclosed comment runs to the end of the file, as in browsers.
  return source.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** The whole stylesheet: rules, @keyframes and @imports. */
export function parseStylesheetFull(source: string): Stylesheet {
  // `<!--` and `-->` are allowed (and ignored) in CSS, from the days of hiding <style> from old browsers.
  const css = blankComments(source).replace(/<!--|-->/g, (marker) => " ".repeat(marker.length));
  const parser = new Parser(css);
  parser.rules(0, css.length, { media: [], depth: 0 });
  return parser.sheet;
}

export function parseStylesheet(source: string): StyleRule[] {
  return parseStylesheetFull(source).rules;
}

const PX_PER_EM = 16;

function px(amount: string, unit: string | undefined): number {
  return Number(amount) * (unit === "em" || unit === "rem" ? PX_PER_EM : 1);
}

function compareWidth(width: number, op: string, value: number): boolean {
  switch (op) {
    case "<=":
      return width <= value;
    case ">=":
      return width >= value;
    case "<":
      return width < value;
    case ">":
      return width > value;
    default:
      return width === value;
  }
}

const FLIP: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "=": "=" };
const LENGTH = String.raw`([\d.]+)(px|em|rem)?`;

function featureMatches(feature: string, width: number): boolean {
  const plain = new RegExp(String.raw`^\(\s*(min-width|max-width|width)\s*:\s*${LENGTH}\s*\)$`).exec(feature);
  if (plain !== null) {
    const value = px(plain[2], plain[3]);
    if (plain[1] === "min-width") return width >= value;
    if (plain[1] === "max-width") return width <= value;
    return width === value;
  }
  const range = new RegExp(String.raw`^\(\s*width\s*(<=|>=|<|>|=)\s*${LENGTH}\s*\)$`).exec(feature);
  if (range !== null) {
    return compareWidth(width, range[1], px(range[2], range[3]));
  }
  const reversed = new RegExp(String.raw`^\(\s*${LENGTH}\s*(<=|>=|<|>|=)\s*width\s*\)$`).exec(feature);
  if (reversed !== null) {
    return compareWidth(width, FLIP[reversed[3]], px(reversed[1], reversed[2]));
  }
  const between = new RegExp(String.raw`^\(\s*${LENGTH}\s*(<=|<)\s*width\s*(<=|<)\s*${LENGTH}\s*\)$`).exec(feature);
  if (between !== null) {
    return (
      compareWidth(width, FLIP[between[3]], px(between[1], between[2])) &&
      compareWidth(width, between[4], px(between[5], between[6]))
    );
  }
  const orientation = /^\(\s*orientation\s*:\s*(landscape|portrait)\s*\)$/.exec(feature);
  if (orientation !== null) {
    // Checks imagine a desktop (wide) or a phone (narrow) screen.
    return (orientation[1] === "landscape") === width >= 800;
  }
  // Anything else (prefers-color-scheme, hover, print…) is treated as not matching.
  return false;
}

function queryMatches(query: string, width: number): boolean {
  let rest = query.trim().toLowerCase();
  if (rest === "") {
    return true;
  }
  let negate = false;
  if (rest.startsWith("not ")) {
    negate = true;
    rest = rest.slice(4);
  } else if (rest.startsWith("only ")) {
    rest = rest.slice(5);
  }
  let ok = true;
  for (const part of rest.split(/\s+and\s+/)) {
    const term = part.trim();
    if (term === "all" || term === "screen") continue;
    if (!featureMatches(term, width)) ok = false;
  }
  return negate ? !ok : ok;
}

/** Whether every @media condition holds on a screen `width` px wide. */
export function mediaMatches(media: string[], width: number): boolean {
  return media.every((list) => splitList(list).some((query) => queryMatches(query, width)));
}
