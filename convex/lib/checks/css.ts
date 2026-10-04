/**
 * A small, forgiving CSS parser. Beginners' CSS is often broken, so this
 * follows the browser's recovery rules where it matters: an unclosed comment
 * runs to the end, a rule with a broken selector is dropped, a declaration
 * missing its `;` swallows the next line. Offsets point into the original
 * source, so the mistake finder can underline the right characters.
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
  selector: string;
  declarations: Declaration[];
  /** Conditions of the @media blocks around the rule, outermost first. */
  media: string[];
  selectorStart: number;
  selectorEnd: number;
  /** Offset of the `{`, and just past the `}` (or the end of the file). */
  open: number;
  close: number;
  /** False when the file ends before the rule's `}`. */
  closed: boolean;
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

/** Declarations of a block body. `base` is the body's offset in the whole file. */
export function parseDeclarations(body: string, base = 0): Declaration[] {
  const out: Declaration[] = [];
  let i = 0;
  while (i < body.length) {
    const stop = scan(body, i, body.length, ";", true);
    const part = body.slice(i, stop);
    const partStart = i;
    i = stop + 1;
    const colon = part.indexOf(":");
    if (colon === -1) {
      continue;
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
    if (!/^-?[a-z][a-z0-9-]*$/.test(property) || value === "") {
      continue;
    }
    const lead = rawProperty.length - rawProperty.trimStart().length;
    out.push({
      property,
      value,
      important,
      start: base + partStart + lead,
      end: base + partStart + part.trimEnd().length,
    });
  }
  return out;
}

/** @media inside @media inside @media…: browsers allow it; nobody needs more than this. */
const MAX_MEDIA_DEPTH = 8;

function parseRules(css: string, start: number, end: number, media: string[], out: StyleRule[]) {
  if (media.length > MAX_MEDIA_DEPTH) {
    return;
  }
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(css[i])) {
      i++;
    }
    if (i >= end) {
      return;
    }
    // At-rules end at `;` (like @import) or own a block. A normal rule's
    // selector runs to its `{`, even across a stray `;`, as in browsers.
    const isAtRule = css[i] === "@";
    const stop = scan(css, i, end, isAtRule ? "{;" : "{", false);
    if (stop >= end) {
      return;
    }
    const raw = css.slice(i, stop);
    const prelude = raw.trim();
    if (css[stop] === ";") {
      i = stop + 1;
      continue;
    }
    const close = blockEnd(css, stop, end);
    const closed = css[close - 1] === "}";
    const bodyEnd = closed ? close - 1 : close;
    if (isAtRule) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (name === "media") {
        parseRules(css, stop + 1, bodyEnd, [...media, prelude.slice(6).trim()], out);
      }
      // @font-face, @keyframes, @supports…: not something checks look at.
    } else if (prelude !== "") {
      const selectorStart = i + (raw.length - raw.trimStart().length);
      out.push({
        selector: prelude,
        declarations: parseDeclarations(css.slice(stop + 1, bodyEnd), stop + 1),
        media,
        selectorStart,
        selectorEnd: selectorStart + prelude.length,
        open: stop,
        close,
        closed,
      });
    }
    i = close;
  }
}

/** Comments become spaces of the same length (newlines kept), so offsets stay true. */
export function blankComments(source: string): string {
  // An unclosed comment runs to the end of the file, as in browsers.
  return source.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, " "));
}

export function parseStylesheet(source: string): StyleRule[] {
  const css = blankComments(source);
  const out: StyleRule[] = [];
  parseRules(css, 0, css.length, [], out);
  return out;
}

const PX_PER_EM = 16;

function featureMatches(feature: string, width: number): boolean {
  const plain = /^\(\s*(min-width|max-width|width)\s*:\s*([\d.]+)(px|em|rem)?\s*\)$/.exec(feature);
  if (plain !== null) {
    const px = Number(plain[2]) * (plain[3] === "em" || plain[3] === "rem" ? PX_PER_EM : 1);
    if (plain[1] === "min-width") return width >= px;
    if (plain[1] === "max-width") return width <= px;
    return width === px;
  }
  const range = /^\(\s*width\s*(<=|>=|<|>)\s*([\d.]+)(px|em|rem)?\s*\)$/.exec(feature);
  if (range !== null) {
    const px = Number(range[2]) * (range[3] === "em" || range[3] === "rem" ? PX_PER_EM : 1);
    switch (range[1]) {
      case "<=":
        return width <= px;
      case ">=":
        return width >= px;
      case "<":
        return width < px;
      default:
        return width > px;
    }
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
  return media.every((list) => list.split(",").some((query) => queryMatches(query, width)));
}
