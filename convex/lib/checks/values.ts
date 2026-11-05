/**
 * CSS values: normalising them so `#f00`, `red` and `rgb(255,0,0)` compare equal,
 * dropping the invalid declarations a browser would drop, and expanding the
 * common shorthands into the properties checks look at.
 */

const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  (
    "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc " +
    "bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a " +
    "burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 " +
    "cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b " +
    "darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b " +
    "darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 " +
    "darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f " +
    "darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff " +
    "dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 " +
    "forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 " +
    "gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 " +
    "indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 " +
    "lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff " +
    "lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 " +
    "lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 " +
    "lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 " +
    "linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd " +
    "mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee " +
    "mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 " +
    "mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 " +
    "olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa " +
    "palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 " +
    "peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 " +
    "red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 " +
    "seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd " +
    "slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c " +
    "teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 " +
    "white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32"
  )
    .split(" ")
    .map((pair) => pair.split(":") as [string, string]),
);

type Rgba = [number, number, number, number];

function hexToRgba(hex: string): Rgba | null {
  let h = hex;
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join("");
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
    return null;
  }
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function channel(token: string, max: number): number | null {
  const m = /^([+-]?\d*\.?\d+)(%?)$/.exec(token);
  if (m === null) return null;
  const n = Number(m[1]);
  return m[2] === "%" ? (n / 100) * max : n;
}

function alpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = channel(token, 1);
  return a === null ? null : Math.min(1, Math.max(0, a));
}

function hue(token: string): number | null {
  const m = /^([+-]?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(token);
  if (m === null) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Parses any CSS colour a beginner might write. Null when it isn't one. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (value === "transparent") return [0, 0, 0, 0];
  if (value in NAMED_COLORS) return hexToRgba(NAMED_COLORS[value]);
  if (value.startsWith("#")) return hexToRgba(value.slice(1));
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (fn === null) return null;
  const parts = fn[2].replace("/", " / ").split(/[\s,]+/).filter((p) => p !== "" && p !== "/");
  if (parts.length < 3 || parts.length > 4) return null;
  const a = alpha(parts[3]);
  if (a === null) return null;
  if (fn[1].startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map((p) => channel(p, 255));
    if (rgb.some((c) => c === null)) return null;
    return [...(rgb as number[]).map((c) => Math.min(255, Math.max(0, c))), a] as Rgba;
  }
  const h = hue(parts[0]);
  const s = channel(parts[1], 1);
  const l = channel(parts[2], 1);
  if (h === null || s === null || l === null) return null;
  return [...hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l))), a] as Rgba;
}


/** Alpha the way browsers print it: two decimals when that is the same 8-bit value. */
function formatAlpha(a: number): number {
  const twoPlaces = Math.round(a * 100) / 100;
  return Math.round(twoPlaces * 255) === Math.round(a * 255) ? twoPlaces : Math.round(a * 1000) / 1000;
}

function formatColor([r, g, b, a]: Rgba): string {
  const c = (n: number) => Math.round(n);
  return a === 1 ? `rgb(${c(r)}, ${c(g)}, ${c(b)})` : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${formatAlpha(a)})`;
}

/** Splits a value on top-level spaces, keeping `rgb(1, 2, 3)` and quoted text whole. */
export function tokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of value.trim()) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== "") out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") out.push(current);
  return out;
}

/** Splits on top-level commas: the layers of `transition`, the fonts of `font-family`. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of value) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === ",") {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/** Spaces around top-level `/`, so `center/cover` reads as three tokens. `url(a/b.png)` keeps its slash. */
function spaceSlashes(value: string): string {
  let depth = 0;
  let quote: string | null = null;
  let out = "";
  for (const ch of value) {
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "/" && depth === 0) {
      out += " / ";
      continue;
    }
    out += ch;
  }
  return out;
}

const NUMBER = /^([+-]?\d*\.?\d+)([a-z%]*)$/;

function normalizeToken(token: string): string {
  const color = parseColor(token);
  if (color !== null) return formatColor(color);
  const number = NUMBER.exec(token);
  if (number !== null) {
    let n = Number(number[1]);
    let unit = number[2];
    if (unit === "ms") {
      n /= 1000;
      unit = "s";
    }
    return n === 0 && unit !== "" ? "0" : `${Math.round(n * 1e6) / 1e6}${unit}`;
  }
  // A whole quoted token ("Open Sans", 'x') compares without its quotes.
  const quoted = /^(["'])(.*)\1$/.exec(token);
  return quoted === null ? token : quoted[2];
}

/** `repeat(3, 1fr)` → `1fr 1fr 1fr`, as browsers compute grid tracks. `auto-fill` stays. */
function expandRepeat(value: string): string {
  return value.replace(/repeat\(\s*(\d+)\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_, count: string, track: string) =>
    Array.from({ length: Math.min(Number(count), 50) }, () => track.trim()).join(" "),
  );
}

const FONT_WEIGHTS: Record<string, string> = { normal: "400", bold: "700" };
const BORDER_WIDTH_PX: Record<string, string> = { thin: "1px", medium: "3px", thick: "5px" };
const POSITION_KEYWORDS: Record<string, string> = { left: "0%", top: "0%", center: "50%", right: "100%", bottom: "100%" };

/** `center` → `50% 50%`, `top left` → `0% 0%`: background-position as browsers compute it. */
function normalizePosition(layer: string): string {
  const parts = tokens(layer);
  if (parts.length === 0 || parts.length > 2) return parts.join(" ");
  let [x, y] = parts.length === 1 ? [parts[0], "center"] : parts;
  // `top left`, `bottom center`: the vertical keyword came first.
  if (x === "top" || x === "bottom" || ((y === "left" || y === "right") && x === "center")) [x, y] = [y, x];
  if (parts.length === 1 && (parts[0] === "top" || parts[0] === "bottom")) [x, y] = ["center", parts[0]];
  return [x, y].map((p) => POSITION_KEYWORDS[p] ?? p).join(" ");
}

/**
 * The form two values are compared in: lower case, one space, colours as
 * rgb(), times in seconds, fonts without quotes. With `property`, also what
 * that property computes to (`bold` is `700`, `center` is `50% 50%`).
 */
export function normalizeValue(value: string, property?: string): string {
  let flat = value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  flat = expandRepeat(flat);
  if (property === "font-weight") {
    return FONT_WEIGHTS[flat] ?? normalizeToken(flat);
  }
  if (property !== undefined && /^border-(top|right|bottom|left)-width$|^outline-width$/.test(property)) {
    return normalizeToken(BORDER_WIDTH_PX[flat] ?? flat);
  }
  if (property === "background-position") {
    return layers(flat).map(normalizePosition).map((layer) => tokens(layer).map(normalizeToken).join(" ")).join(",");
  }
  if (property === "text-decoration-line") {
    return tokens(flat).sort().join(" ");
  }
  return layers(flat)
    .map((layer) => tokens(layer.replace(/\s*,\s*/g, ",")).map(normalizeToken).join(" "))
    .join(",");
}

// --- What a browser accepts ----------------------------------------------------

const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const LENGTH_UNITS =
  "px|em|rem|%|vh|vw|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|cm|mm|in|pt|pc|q|cqw|cqh|fr";
const LENGTH = new RegExp(`^[+-]?(\\d*\\.?\\d+)(${LENGTH_UNITS})$`);
const FUNCTION = /^(calc|min|max|clamp|var|env)\(/;
const TIME = /^[+-]?(\d*\.?\d+)(s|ms)$/;

function isLength(token: string, { negative = true } = {}): boolean {
  if (token === "0" || FUNCTION.test(token)) return true;
  const m = LENGTH.exec(token);
  return m !== null && (negative || !token.startsWith("-"));
}

function isTime(token: string): boolean {
  return TIME.test(token) || FUNCTION.test(token);
}

const BORDER_STYLES = new Set([
  "none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset",
]);
const BORDER_WIDTHS = new Set(["thin", "medium", "thick"]);

const KEYWORDS: Record<string, Set<string>> = {
  display: new Set([
    "block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "none",
    "contents", "flow-root", "list-item", "table", "table-row", "table-cell", "inline-table",
    "table-caption", "table-header-group", "table-row-group", "table-footer-group",
  ]),
  position: new Set(["static", "relative", "absolute", "fixed", "sticky"]),
  "text-align": new Set(["left", "right", "center", "justify", "start", "end", "match-parent"]),
  "flex-direction": new Set(["row", "row-reverse", "column", "column-reverse"]),
  "flex-wrap": new Set(["nowrap", "wrap", "wrap-reverse"]),
  "justify-content": new Set([
    "flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start",
    "end", "left", "right", "normal", "stretch",
  ]),
  "align-items": new Set(["flex-start", "flex-end", "center", "baseline", "stretch", "start", "end", "normal", "self-start", "self-end"]),
  "font-style": new Set(["normal", "italic", "oblique"]),
  "text-transform": new Set(["none", "uppercase", "lowercase", "capitalize", "full-width"]),
  "box-sizing": new Set(["content-box", "border-box"]),
  float: new Set(["left", "right", "none", "inline-start", "inline-end"]),
  overflow: new Set(["visible", "hidden", "scroll", "auto", "clip"]),
  "overflow-x": new Set(["visible", "hidden", "scroll", "auto", "clip"]),
  "overflow-y": new Set(["visible", "hidden", "scroll", "auto", "clip"]),
  visibility: new Set(["visible", "hidden", "collapse"]),
  "animation-direction": new Set(["normal", "reverse", "alternate", "alternate-reverse"]),
  "animation-fill-mode": new Set(["none", "forwards", "backwards", "both"]),
  "animation-play-state": new Set(["running", "paused"]),
};

const COLOR_PROPERTIES = new Set([
  "color", "background-color", "border-color", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "caret-color",
  "accent-color",
]);

const SIZE_KEYWORDS = ["auto", "fit-content", "min-content", "max-content"];

const LENGTH_PROPERTIES: Record<string, { keywords: string[]; negative: boolean; max?: number }> = {
  width: { keywords: SIZE_KEYWORDS, negative: false },
  height: { keywords: SIZE_KEYWORDS, negative: false },
  "min-width": { keywords: SIZE_KEYWORDS, negative: false },
  "min-height": { keywords: SIZE_KEYWORDS, negative: false },
  "max-width": { keywords: ["none", "fit-content", "min-content", "max-content"], negative: false },
  "max-height": { keywords: ["none", "fit-content", "min-content", "max-content"], negative: false },
  "font-size": {
    keywords: ["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "smaller", "larger"],
    negative: false,
  },
  "border-radius": { keywords: [], negative: false, max: 4 },
  top: { keywords: ["auto"], negative: true },
  right: { keywords: ["auto"], negative: true },
  bottom: { keywords: ["auto"], negative: true },
  left: { keywords: ["auto"], negative: true },
  "row-gap": { keywords: ["normal"], negative: false },
  "column-gap": { keywords: ["normal"], negative: false },
  "flex-basis": { keywords: ["auto", "content", ...SIZE_KEYWORDS], negative: false },
  "letter-spacing": { keywords: ["normal"], negative: true },
  "word-spacing": { keywords: ["normal"], negative: true },
  "text-indent": { keywords: [], negative: true },
  "outline-width": { keywords: ["thin", "medium", "thick"], negative: false },
  "outline-offset": { keywords: [], negative: true },
  ...Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).flatMap((side) => [
      [`margin-${side}`, { keywords: ["auto"], negative: true }],
      [`padding-${side}`, { keywords: [], negative: false }],
      [`border-${side}-width`, { keywords: ["thin", "medium", "thick"], negative: false }],
    ]),
  ),
  ...Object.fromEntries(
    ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) => [
      `border-${corner}-radius`,
      { keywords: [], negative: false, max: 2 },
    ]),
  ),
};

const TIME_PROPERTIES = new Set(["transition-duration", "transition-delay", "animation-duration", "animation-delay"]);

/**
 * False for the mistakes a browser silently ignores: `width: 100` (no unit),
 * `display: flexbox`, `color: grean`. Properties it doesn't know are accepted.
 */
export function isValidDeclaration(property: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (GLOBAL.has(v) || v.includes("var(") || property.startsWith("--")) return true;
  if (COLOR_PROPERTIES.has(property)) {
    return v === "currentcolor" || parseColor(v) !== null || (property === "border-color" && tokens(v).length <= 4 && tokens(v).every((t) => t === "currentcolor" || parseColor(t) !== null));
  }
  const keywords = KEYWORDS[property];
  if (keywords !== undefined) {
    return property === "overflow"
      ? tokens(v).length <= 2 && tokens(v).every((t) => keywords.has(t))
      : layers(v).every((layer) => keywords.has(layer));
  }
  if (property === "font-weight") {
    return ["normal", "bold", "bolder", "lighter"].includes(v) || /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 1000;
  }
  if (TIME_PROPERTIES.has(property)) {
    return layers(v).every(isTime);
  }
  if (property === "opacity") {
    return /^[+-]?\d*\.?\d+%?$/.test(v) || FUNCTION.test(v);
  }
  const lengths = LENGTH_PROPERTIES[property];
  if (lengths !== undefined) {
    const parts = tokens(property === "border-radius" ? v.replace("/", " ") : v);
    return (
      parts.length >= 1 &&
      parts.length <= (property === "border-radius" ? 8 : (lengths.max ?? 1)) &&
      parts.every((t) => lengths.keywords.includes(t) || isLength(t, { negative: lengths.negative }))
    );
  }
  return true;
}

// --- Shorthands -----------------------------------------------------------------

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

/** `1px 2px` → top, right, bottom, left, the way margin and padding read them. */
function quad(parts: string[]): [string, string, string, string] | null {
  switch (parts.length) {
    case 1:
      return [parts[0], parts[0], parts[0], parts[0]];
    case 2:
      return [parts[0], parts[1], parts[0], parts[1]];
    case 3:
      return [parts[0], parts[1], parts[2], parts[1]];
    case 4:
      return [parts[0], parts[1], parts[2], parts[3]];
    default:
      return null;
  }
}

type Longhand = { property: string; value: string };

function borderParts(parts: string[]): { width: string; style: string; color: string } | null {
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const part of parts) {
    if (width === undefined && (BORDER_WIDTHS.has(part) || isLength(part, { negative: false }))) {
      width = part;
    } else if (style === undefined && BORDER_STYLES.has(part)) {
      style = part;
    } else if (color === undefined && (part === "currentcolor" || parseColor(part) !== null)) {
      color = part;
    } else {
      return null;
    }
  }
  const finalStyle = style ?? "none";
  // A border with no style has no width, whatever was written: `border: none` and `border: 0` are the same.
  return {
    width: finalStyle === "none" || finalStyle === "hidden" ? "0" : (width ?? "medium"),
    style: finalStyle,
    color: color ?? "currentcolor",
  };
}

const LIST_STYLE_TYPES = new Set([
  "disc", "circle", "square", "decimal", "decimal-leading-zero", "lower-roman", "upper-roman",
  "lower-alpha", "upper-alpha", "lower-latin", "upper-latin", "lower-greek", "georgian", "armenian",
]);

const TRANSITION_LONGHANDS = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"];
const ANIMATION_LONGHANDS = [
  "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
  "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state",
];
const BACKGROUND_LONGHANDS = [
  "background-color", "background-image", "background-repeat", "background-position", "background-size",
  "background-attachment",
];
const FONT_LONGHANDS = ["font-style", "font-variant", "font-weight", "font-size", "line-height", "font-family"];

/** The longhands each supported shorthand sets. */
const LONGHANDS: Record<string, string[]> = {
  margin: SIDES.map((side) => `margin-${side}`),
  padding: SIDES.map((side) => `padding-${side}`),
  inset: [...SIDES],
  "border-width": SIDES.map((side) => `border-${side}-width`),
  "border-style": SIDES.map((side) => `border-${side}-style`),
  "border-color": SIDES.map((side) => `border-${side}-color`),
  border: SIDES.flatMap((side) => ["width", "style", "color"].map((x) => `border-${side}-${x}`)),
  ...Object.fromEntries(
    SIDES.map((side) => [`border-${side}`, ["width", "style", "color"].map((x) => `border-${side}-${x}`)]),
  ),
  "border-radius": CORNERS.map((corner) => `border-${corner}-radius`),
  outline: ["outline-width", "outline-style", "outline-color"],
  background: BACKGROUND_LONGHANDS,
  gap: ["row-gap", "column-gap"],
  "grid-gap": ["row-gap", "column-gap"],
  "grid-row-gap": ["row-gap"],
  "grid-column-gap": ["column-gap"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  overflow: ["overflow-x", "overflow-y"],
  font: FONT_LONGHANDS,
  "list-style": ["list-style-type", "list-style-position", "list-style-image"],
  "text-decoration": ["text-decoration-line"],
  transition: TRANSITION_LONGHANDS,
  animation: ANIMATION_LONGHANDS,
};

/** Shorthands checks can ask about; they pass when every longhand matches. */
export function isShorthand(property: string): boolean {
  return property in LONGHANDS;
}

const PLAIN_NUMBER = /^\d*\.?\d+$/;

function expandFlex(v: string, parts: string[]): [string, string, string] | null {
  if (v === "none") return ["0", "0", "auto"];
  if (v === "auto") return ["1", "1", "auto"];
  const isBasis = (p: string) => p === "auto" || p === "content" || isLength(p, { negative: false });
  const [a, b, c] = parts;
  switch (parts.length) {
    case 1:
      if (PLAIN_NUMBER.test(a)) return [a, "1", "0%"];
      return isBasis(a) ? ["1", "1", a] : null;
    case 2:
      if (!PLAIN_NUMBER.test(a)) return null;
      if (PLAIN_NUMBER.test(b)) return [a, b, "0%"];
      return isBasis(b) ? [a, "1", b] : null;
    case 3:
      return PLAIN_NUMBER.test(a) && PLAIN_NUMBER.test(b) && isBasis(c) ? [a, b, c] : null;
    default:
      return null;
  }
}

const TIMING_KEYWORDS = new Set(["ease", "linear", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
const isTiming = (t: string) => TIMING_KEYWORDS.has(t) || /^(cubic-bezier|steps|linear)\(/.test(t);

/** One layer of `transition`: property, duration, timing, delay. */
function transitionLayer(layer: string): string[] | null {
  let property: string | undefined;
  let timing: string | undefined;
  const times: string[] = [];
  for (const part of tokens(layer)) {
    if (isTime(part) && times.length < 2) times.push(part);
    else if (timing === undefined && isTiming(part)) timing = part;
    else if (property === undefined && /^-?[a-z][a-z0-9-]*$/.test(part)) property = part;
    else if (part !== "allow-discrete" && part !== "normal") return null;
  }
  return [property ?? "all", times[0] ?? "0s", timing ?? "ease", times[1] ?? "0s"];
}

/** One layer of `animation`. Keywords of the other properties win over a name, as in browsers. */
function animationLayer(layer: string): string[] | null {
  const set: Record<string, string> = {};
  const times: string[] = [];
  for (const part of tokens(layer)) {
    if (isTime(part) && times.length < 2) times.push(part);
    else if (set.timing === undefined && isTiming(part)) set.timing = part;
    else if (set.count === undefined && (part === "infinite" || PLAIN_NUMBER.test(part))) set.count = part;
    else if (set.direction === undefined && KEYWORDS["animation-direction"].has(part)) set.direction = part;
    else if (set.fill === undefined && KEYWORDS["animation-fill-mode"].has(part)) set.fill = part;
    else if (set.state === undefined && KEYWORDS["animation-play-state"].has(part)) set.state = part;
    else if (set.name === undefined && /^(-?[a-z_][a-z0-9_-]*|"[^"]*"|'[^']*')$/.test(part)) set.name = part.replace(/^["']|["']$/g, "");
    else return null;
  }
  return [
    set.name ?? "none",
    times[0] ?? "0s",
    set.timing ?? "ease",
    times[1] ?? "0s",
    set.count ?? "1",
    set.direction ?? "normal",
    set.fill ?? "none",
    set.state ?? "running",
  ];
}

const REPEAT_KEYWORDS = new Set(["repeat-x", "repeat-y", "repeat", "space", "round", "no-repeat"]);
const ATTACHMENTS = new Set(["scroll", "fixed", "local"]);
const BOXES = new Set(["border-box", "padding-box", "content-box", "text"]);
const POSITION_WORDS = new Set(["left", "right", "top", "bottom", "center"]);

/** One layer of `background`: color, image, repeat, position, size, attachment. */
function backgroundLayer(layer: string, last: boolean): string[] | null {
  let color: string | undefined;
  let image: string | undefined;
  const repeat: string[] = [];
  const position: string[] = [];
  const size: string[] = [];
  let attachment: string | undefined;
  let afterSlash = false;
  for (const part of tokens(spaceSlashes(layer))) {
    if (part === "/") {
      if (position.length === 0) return null;
      afterSlash = true;
    } else if (afterSlash && size.length < 2 && (part === "cover" || part === "contain" || part === "auto" || isLength(part, { negative: false }))) {
      size.push(part);
    } else if (image === undefined && (part === "none" || /^(url|linear-gradient|radial-gradient|conic-gradient|repeating-[a-z-]+gradient|image-set)\(/.test(part))) {
      image = part;
    } else if (repeat.length < 2 && REPEAT_KEYWORDS.has(part)) {
      repeat.push(part);
    } else if (attachment === undefined && ATTACHMENTS.has(part)) {
      attachment = part;
    } else if (!afterSlash && position.length < 4 && (POSITION_WORDS.has(part) || isLength(part))) {
      position.push(part);
    } else if (BOXES.has(part)) {
      // background-origin / background-clip: not something checks look at.
    } else if (last && color === undefined && (part === "currentcolor" || parseColor(part) !== null)) {
      color = part;
    } else {
      return null;
    }
  }
  if (afterSlash && size.length === 0) return null;
  return [
    color ?? "transparent",
    image ?? "none",
    repeat.length === 0 ? "repeat" : repeat.join(" "),
    position.length === 0 ? "0% 0%" : position.join(" "),
    size.length === 0 ? "auto" : size.join(" "),
    attachment ?? "scroll",
  ];
}

const FONT_SIZE_WORDS = new Set(LENGTH_PROPERTIES["font-size"].keywords);
const SYSTEM_FONTS = new Set(["caption", "icon", "menu", "message-box", "small-caption", "status-bar"]);

/** `font: italic bold 20px/1.5 "Open Sans", sans-serif` */
function expandFont(v: string): string[] | null {
  if (SYSTEM_FONTS.has(v)) return ["normal", "normal", "normal", "medium", "normal", v];
  const parts = tokens(spaceSlashes(v));
  let style = "normal";
  let variant = "normal";
  let weight = "normal";
  let i = 0;
  for (; i < parts.length; i++) {
    const p = parts[i];
    if (FONT_SIZE_WORDS.has(p) || isLength(p, { negative: false })) break;
    if (p === "normal") continue;
    if (p === "italic" || p === "oblique") style = p;
    else if (p === "small-caps") variant = p;
    else if (["bold", "bolder", "lighter"].includes(p) || (/^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 1000)) weight = p;
    else if (/condensed|expanded/.test(p)) continue;
    else return null;
  }
  const size = parts[i];
  if (size === undefined) return null;
  let lineHeight = "normal";
  let rest = parts.slice(i + 1);
  if (rest[0] === "/") {
    if (rest[1] === undefined) return null;
    lineHeight = rest[1];
    rest = rest.slice(2);
  }
  if (rest.length === 0) return null;
  return [style, variant, weight, size, lineHeight, rest.join(" ")];
}

/**
 * The longhands a shorthand sets, or null if the browser would drop it.
 * Properties that aren't shorthands come back as themselves.
 */
export function expand(property: string, value: string): Longhand[] | null {
  const v = value.trim().toLowerCase();
  const longhands = LONGHANDS[property];
  if (longhands === undefined) {
    return [{ property, value: v }];
  }
  // `inherit`, `initial`, var(…): every longhand gets the same value.
  if (GLOBAL.has(v) || v.includes("var(")) {
    return longhands.map((longhand) => ({ property: longhand, value: v }));
  }
  const parts = tokens(v);
  const assign = (values: string[]) => longhands.map((longhand, i) => ({ property: longhand, value: values[i] }));
  /** Comma-separated layers, each longhand listing its value per layer. */
  const layered = (read: (layer: string, index: number, count: number) => string[] | null) => {
    const all = layers(v);
    const values: string[][] = [];
    for (const [index, layer] of all.entries()) {
      const one = read(layer, index, all.length);
      if (one === null) return null;
      values.push(one);
    }
    return assign(longhands.map((_, i) => values.map((layer) => layer[i]).join(", ")));
  };
  switch (property) {
    case "margin":
    case "padding":
    case "inset": {
      const values = quad(parts);
      const valid = values?.every(
        (t) => isLength(t, { negative: property !== "padding" }) || (property !== "padding" && t === "auto"),
      );
      return values && valid ? assign(values) : null;
    }
    case "border-width":
    case "border-style":
    case "border-color": {
      const values = quad(parts);
      return values === null ? null : assign(values);
    }
    case "border-radius": {
      const [horizontal, vertical] = v.split("/").map((side) => quad(tokens(side)));
      if (horizontal === null || horizontal === undefined || vertical === null) return null;
      if (![...horizontal, ...(vertical ?? [])].every((t) => isLength(t, { negative: false }))) return null;
      return assign(horizontal.map((h, i) => (vertical === undefined || vertical[i] === h ? h : `${h} ${vertical[i]}`)));
    }
    case "background": {
      const result = layered((layer, index, count) => backgroundLayer(layer, index === count - 1));
      // Only the last layer has a colour.
      return result?.map((longhand) =>
        longhand.property === "background-color" ? { ...longhand, value: longhand.value.split(", ").at(-1)! } : longhand,
      ) ?? null;
    }
    case "gap":
    case "grid-gap": {
      if (parts.length < 1 || parts.length > 2) return null;
      if (!parts.every((p) => p === "normal" || isLength(p, { negative: false }))) return null;
      return assign([parts[0], parts[1] ?? parts[0]]);
    }
    case "grid-row-gap":
    case "grid-column-gap":
      return parts.length === 1 && (parts[0] === "normal" || isLength(parts[0], { negative: false })) ? assign(parts) : null;
    case "flex": {
      const values = expandFlex(v, parts);
      return values === null ? null : assign(values);
    }
    case "flex-flow": {
      let direction: string | undefined;
      let wrap: string | undefined;
      for (const part of parts) {
        if (direction === undefined && KEYWORDS["flex-direction"].has(part)) direction = part;
        else if (wrap === undefined && KEYWORDS["flex-wrap"].has(part)) wrap = part;
        else return null;
      }
      return parts.length === 0 ? null : assign([direction ?? "row", wrap ?? "nowrap"]);
    }
    case "place-items":
    case "place-content":
    case "place-self":
      return parts.length === 1 || parts.length === 2 ? assign([parts[0], parts[1] ?? parts[0]]) : null;
    case "overflow":
      return (parts.length === 1 || parts.length === 2) && parts.every((p) => KEYWORDS.overflow.has(p))
        ? assign([parts[0], parts[1] ?? parts[0]])
        : null;
    case "font": {
      const values = expandFont(v);
      return values === null ? null : assign(values);
    }
    case "list-style": {
      let type = "disc";
      let position = "outside";
      let image = "none";
      for (const part of parts) {
        if (part === "inside" || part === "outside") position = part;
        else if (part.startsWith("url(")) image = part;
        else if (part === "none" || LIST_STYLE_TYPES.has(part)) type = part;
        else return null;
      }
      return assign([type, position, image]);
    }
    case "text-decoration": {
      const lines = parts.filter((p) => ["none", "underline", "overline", "line-through"].includes(p));
      return assign([lines.length > 0 ? lines.join(" ") : "none"]);
    }
    case "transition":
      return layered(transitionLayer);
    case "animation":
      return layered(animationLayer);
    case "outline": {
      const outline = borderParts(parts.map((p) => (p === "auto" ? "solid" : p)));
      return outline === null ? null : assign([outline.width, outline.style, outline.color]);
    }
    default: {
      // border and border-<side>: width, style and colour in any order, repeated per side.
      const border = borderParts(parts);
      if (border === null) return null;
      return longhands.map((longhand) => ({
        property: longhand,
        value: longhand.endsWith("-width") ? border.width : longhand.endsWith("-style") ? border.style : border.color,
      }));
    }
  }
}

/** Starting values for the longhands above (and display), when nothing sets them. */
export const INITIAL: Record<string, string> = {
  display: "inline",
  color: "black",
  "font-size": "16px",
  "font-style": "normal",
  "font-variant": "normal",
  "font-weight": "normal",
  "line-height": "normal",
  "background-color": "transparent",
  "background-image": "none",
  "background-repeat": "repeat",
  "background-position": "0% 0%",
  "background-size": "auto",
  "background-attachment": "scroll",
  "row-gap": "normal",
  "column-gap": "normal",
  "flex-grow": "0",
  "flex-shrink": "1",
  "flex-basis": "auto",
  "list-style-type": "disc",
  "list-style-position": "outside",
  "list-style-image": "none",
  "text-decoration-line": "none",
  position: "static",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  "z-index": "auto",
  "text-align": "start",
  "text-transform": "none",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "justify-content": "normal",
  "align-items": "normal",
  "align-content": "normal",
  "justify-items": "legacy",
  "align-self": "auto",
  "justify-self": "auto",
  "overflow-x": "visible",
  "overflow-y": "visible",
  visibility: "visible",
  opacity: "1",
  transform: "none",
  "box-sizing": "content-box",
  width: "auto",
  height: "auto",
  cursor: "auto",
  "outline-width": "medium",
  "outline-style": "none",
  "outline-color": "currentcolor",
  "transition-property": "all",
  "transition-duration": "0s",
  "transition-timing-function": "ease",
  "transition-delay": "0s",
  "animation-name": "none",
  "animation-duration": "0s",
  "animation-timing-function": "ease",
  "animation-delay": "0s",
  "animation-iteration-count": "1",
  "animation-direction": "normal",
  "animation-fill-mode": "none",
  "animation-play-state": "running",
  ...Object.fromEntries(CORNERS.map((corner) => [`border-${corner}-radius`, "0"])),
  ...Object.fromEntries(
    SIDES.flatMap((side) => [
      [`margin-${side}`, "0"],
      [`padding-${side}`, "0"],
      [`border-${side}-width`, "medium"],
      [`border-${side}-style`, "none"],
      [`border-${side}-color`, "currentcolor"],
    ]),
  ),
};

/** Properties a child takes from its parent when nothing sets them. */
export const INHERITED = new Set([
  "color", "font", "font-family", "font-size", "font-style", "font-weight", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent", "text-transform",
  "text-shadow", "white-space", "visibility", "cursor", "direction", "list-style", "list-style-type",
  "list-style-position", "list-style-image", "quotes", "border-collapse", "border-spacing",
  "caption-side", "empty-cells",
]);
