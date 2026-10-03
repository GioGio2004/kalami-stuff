import { blankComments, isValidDeclaration, Page, parseStylesheet, selectorError } from "@/lib/checks";
import type { CodeFile, SandboxAsset } from "../types";
import type { Locale } from "./dictionary";

/**
 * The mistake finder. HTML and CSS never show an error: the browser silently
 * guesses and carries on, which is where beginners get stuck. This finds the
 * mistakes the browser forgives and explains each in one sentence.
 */

export type Severity = "error" | "warning" | "info";

export type Mistake = {
  file: string;
  from: number;
  to: number;
  /** 1-based, for the list next to the steps. */
  line: number;
  severity: Severity;
  code: string;
  message: string;
};

const HTML_TAGS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col " +
    "colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 " +
    "h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta " +
    "meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search " +
    "section select slot small source span strong style sub summary sup svg table tbody td template textarea tfoot th " +
    "thead time title tr track u ul var video wbr math"
  ).split(" "),
);

const VOID_TAGS = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
/** Tags whose closing tag HTML allows you to leave out: a warning, not an error. */
const OPTIONAL_END = new Set("html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup rt rp".split(" "));
/** Content that isn't HTML: the scanner skips to the closing tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const CSS_PROPERTIES = new Set(
  (
    "accent-color align-content align-items align-self all animation animation-delay animation-direction " +
    "animation-duration animation-fill-mode animation-iteration-count animation-name animation-play-state " +
    "animation-timing-function appearance aspect-ratio backdrop-filter backface-visibility background " +
    "background-attachment background-blend-mode background-clip background-color background-image background-origin " +
    "background-position background-position-x background-position-y background-repeat background-size block-size " +
    "border border-block border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius " +
    "border-bottom-style border-bottom-width border-collapse border-color border-image border-inline border-left " +
    "border-left-color border-left-style border-left-width border-radius border-right border-right-color " +
    "border-right-style border-right-width border-spacing border-style border-top border-top-color " +
    "border-top-left-radius border-top-right-radius border-top-style border-top-width border-width bottom " +
    "box-shadow box-sizing break-after break-before caption-side caret-color clear clip-path color column-count " +
    "column-gap column-rule column-width columns content counter-increment counter-reset cursor direction display " +
    "empty-cells filter flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap float font " +
    "font-family font-feature-settings font-kerning font-size font-stretch font-style font-variant font-weight gap " +
    "grid grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-start " +
    "grid-row grid-row-end grid-row-start grid-template grid-template-areas grid-template-columns " +
    "grid-template-rows height hyphens image-rendering inline-size inset isolation justify-content justify-items " +
    "justify-self left letter-spacing line-height list-style list-style-image list-style-position list-style-type " +
    "margin margin-block margin-bottom margin-inline margin-left margin-right margin-top mask max-height max-width " +
    "min-height min-width mix-blend-mode object-fit object-position opacity order outline outline-color " +
    "outline-offset outline-style outline-width overflow overflow-wrap overflow-x overflow-y padding padding-block " +
    "padding-bottom padding-inline padding-left padding-right padding-top place-content place-items place-self " +
    "pointer-events position quotes resize right rotate row-gap scale scroll-behavior scroll-margin " +
    "scroll-padding scroll-snap-align scroll-snap-type tab-size table-layout text-align text-align-last " +
    "text-decoration text-decoration-color text-decoration-line text-decoration-style text-decoration-thickness " +
    "text-indent text-overflow text-shadow text-transform text-underline-offset top transform transform-origin " +
    "transition transition-delay transition-duration transition-property transition-timing-function translate " +
    "user-select vertical-align visibility white-space width will-change word-break word-spacing word-wrap " +
    "writing-mode z-index"
  ).split(" "),
);

type Params = Record<string, string>;
type Message = { ka: string; en: string };

const MESSAGES: Record<string, Message> = {
  "unknown-tag": { ka: "<{tag}> HTML ტეგი არ არის.{suggest}", en: "<{tag}> isn't an HTML tag.{suggest}" },
  unclosed: { ka: "<{tag}> არ არის დახურული. დაამატე </{tag}>.", en: "<{tag}> is never closed. Add </{tag}>." },
  "stray-close": {
    ka: "</{tag}> ხურავს ტეგს, რომელიც არ არის გახსნილი.",
    en: "</{tag}> closes a tag that isn't open.",
  },
  misnested: {
    ka: "</{tag}> მოდის </{inner}>-მდე. ჯერ შიდა <{inner}> დახურე.",
    en: "</{tag}> comes before </{inner}>. Close the inner <{inner}> first.",
  },
  "void-close": {
    ka: "<{tag}>-ს დამხურავი ტეგი არ აქვს; წაშალე </{tag}>.",
    en: "<{tag}> has no closing tag; remove </{tag}>.",
  },
  "img-alt": {
    ka: "სურათს alt ტექსტი არ აქვს. აღწერე ის მათთვის, ვინც ვერ ხედავს.",
    en: "This image has no alt text. Describe it for people who can't see it.",
  },
  "class-dot": {
    ka: "კლასის სახელი წერტილის გარეშე დაწერე: class=\"{name}\". წერტილი მხოლოდ CSS-ში იწერება.",
    en: "Write class names without the dot: class=\"{name}\". The dot is only for CSS.",
  },
  "id-hash": {
    ka: "id #-ის გარეშე დაწერე: id=\"{name}\". # მხოლოდ CSS-ში იწერება.",
    en: "Write the id without #: id=\"{name}\". The # is only for CSS.",
  },
  "missing-file": {
    ka: "ფაილი \"{href}\" არ არსებობს. შენი ფაილები: {files}.",
    en: "There's no file \"{href}\". Your files: {files}.",
  },
  "css-not-linked": {
    ka: "style.css მიბმული არ არის, ამიტომ შენი CSS არ მოქმედებს. <head>-ში დაამატე <link rel=\"stylesheet\" href=\"style.css\">.",
    en: "style.css isn't linked, so your CSS doesn't apply. Add <link rel=\"stylesheet\" href=\"style.css\"> inside <head>.",
  },
  "missing-image": {
    ka: "სურათი \"{src}\" არ არსებობს. გამოსაყენებელი სურათები: {list}.",
    en: "There's no image \"{src}\". Images you can use: {list}.",
  },
  "no-images": {
    ka: "ამ დავალებაში სურათები არ არის, ამიტომ \"{src}\" არ გამოჩნდება.",
    en: "This task has no images, so \"{src}\" won't show.",
  },
  script: {
    ka: "JavaScript ჯერ ამ კურსის ნაწილი არ არის, ამიტომ <script> აქ არ გაეშვება.",
    en: "JavaScript isn't part of this course yet, so <script> won't run here.",
  },
  "unknown-property": {
    ka: "\"{prop}\" CSS თვისება არ არის.{suggest}",
    en: "\"{prop}\" isn't a CSS property.{suggest}",
  },
  "invalid-value": {
    ka: "\"{value}\" {prop}-ისთვის არასწორი მნიშვნელობაა, ამიტომ ბრაუზერი ამ ხაზს უგულებელყოფს.{tip}",
    en: "\"{value}\" isn't a valid value for {prop}, so the browser ignores this line.{tip}",
  },
  "missing-semicolon": {
    ka: "ამ ხაზის ბოლოს ; აკლია, ამიტომ შემდეგი ხაზიც იკარგება.",
    en: "This line is missing its ; so the next line is lost too.",
  },
  "missing-colon": {
    ka: "აქ ორწერტილი აკლია: თვისება: მნიშვნელობა;",
    en: "This needs a colon: property: value;",
  },
  "unclosed-block": { ka: "ეს { არ არის დახურული }-ით.", en: "This { is never closed with }." },
  "invalid-selector": {
    ka: "\"{selector}\" არასწორი სელექტორია, ამიტომ მთელი წესი იგნორირდება.",
    en: "\"{selector}\" isn't a valid selector, so the whole rule is ignored.",
  },
  "selector-no-match": {
    ka: "გვერდზე არაფერი ემთხვევა \"{selector}\"-ს.",
    en: "Nothing on the page matches \"{selector}\".",
  },
};

const SUGGEST: Message = { ka: " იქნებ {s} გულისხმობდი?", en: " Did you mean {s}?" };
const UNIT_TIP: Message = { ka: " რიცხვს ერთეული სჭირდება, მაგ. {value}px.", en: " Numbers need a unit, like {value}px." };

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match);
}

/** `s` is a suggested fix (a tag or property name), `unit` a number that needs a unit. */
function say(code: string, locale: Locale, params: Params): string {
  return format(MESSAGES[code][locale], {
    ...params,
    suggest: params.s ? format(SUGGEST[locale], { s: params.s }) : "",
    tip: params.unit ? format(UNIT_TIP[locale], { value: params.unit }) : "",
  });
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** The closest known word, if it's close enough to be a typo. */
function closest(word: string, known: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = word.length > 6 ? 3 : 2;
  for (const candidate of known) {
    const d = distance(word, candidate);
    if (d < bestDistance || (d === bestDistance && best === null && d <= 1)) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function normalizeRef(ref: string): string {
  return ref.trim().replace(/^\.\//, "").replace(/[?#].*$/, "");
}

type Push = (from: number, to: number, severity: Severity, code: string, params?: Params) => void;

function lintHtml(file: CodeFile, files: CodeFile[], assets: SandboxAsset[], push: Push) {
  // Comments become spaces so offsets stay true.
  const html = file.content.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => c.replace(/[^\n]/g, " "));
  const stack: { tag: string; from: number; to: number }[] = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(>?)/g;
  const fileNames = files.map((f) => f.name);
  const assetNames = new Set(assets.map((a) => a.name));
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const [whole, slash, rawName, attrs] = match;
    const tag = rawName.toLowerCase();
    const from = match.index;
    const to = from + whole.length;
    const nameFrom = from + 1 + slash.length;
    const nameTo = nameFrom + rawName.length;
    if (!HTML_TAGS.has(tag) && !tag.includes("-")) {
      const s = closest(tag, HTML_TAGS);
      if (slash === "") push(nameFrom, nameTo, "error", "unknown-tag", s ? { tag, s: `<${s}>` } : { tag });
      // One message is enough: an unknown tag doesn't also count as open or stray.
      continue;
    }
    if (slash === "/") {
      if (VOID_TAGS.has(tag)) {
        push(from, to, "warning", "void-close", { tag });
        continue;
      }
      const depth = stack.map((t) => t.tag).lastIndexOf(tag);
      if (depth === -1) {
        push(from, to, "error", "stray-close", { tag });
        continue;
      }
      for (const inner of stack.splice(depth + 1).reverse()) {
        const severity = OPTIONAL_END.has(inner.tag) ? "warning" : "error";
        // Reaching </body> with a <div> still open reads better as "never closed".
        const code = tag === "body" || tag === "html" || tag === "head" ? "unclosed" : "misnested";
        push(inner.from, inner.to, severity, code, { tag: code === "unclosed" ? inner.tag : tag, inner: inner.tag });
      }
      stack.pop();
      continue;
    }
    // Attributes.
    const attrBase = nameTo;
    const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const attributes = new Map<string, { value: string; from: number; to: number }>();
    let a: RegExpExecArray | null;
    while ((a = attrPattern.exec(attrs)) !== null) {
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      attributes.set(a[1].toLowerCase(), { value, from: attrBase + a.index, to: attrBase + a.index + a[0].length });
    }
    const cls = attributes.get("class");
    if (cls && /(^|\s)\./.test(cls.value)) {
      push(cls.from, cls.to, "warning", "class-dot", { name: cls.value.replace(/(^|\s)\./g, "$1").trim() });
    }
    const id = attributes.get("id");
    if (id && id.value.startsWith("#")) {
      push(id.from, id.to, "warning", "id-hash", { name: id.value.slice(1) });
    }
    if (tag === "img") {
      if (!attributes.has("alt")) push(nameFrom, nameTo, "warning", "img-alt");
      const src = attributes.get("src");
      if (src && !/^(https?:|data:)/i.test(src.value) && src.value.trim() !== "") {
        const ref = normalizeRef(src.value);
        if (!assetNames.has(ref)) {
          if (assets.length === 0) push(src.from, src.to, "warning", "no-images", { src: ref });
          else push(src.from, src.to, "error", "missing-image", { src: ref, list: [...assetNames].join(", ") });
        }
      }
    }
    if (tag === "link" && /stylesheet/i.test(attributes.get("rel")?.value ?? "")) {
      const href = attributes.get("href");
      if (href && !/^(https?:)?\/\//i.test(href.value) && !fileNames.includes(normalizeRef(href.value))) {
        push(href.from, href.to, "error", "missing-file", { href: normalizeRef(href.value), files: fileNames.join(", ") });
      }
    }
    if (tag === "script") push(nameFrom, nameTo, "info", "script");
    const selfClosing = /\/\s*$/.test(attrs);
    if (VOID_TAGS.has(tag) || selfClosing) continue;
    if (RAW_TEXT.has(tag)) {
      // Skip to the end of the raw text, e.g. CSS inside <style>.
      const end = html.toLowerCase().indexOf(`</${tag}`, to);
      tagPattern.lastIndex = end === -1 ? html.length : end;
    }
    stack.push({ tag, from: nameFrom, to: nameTo });
  }
  for (const open of stack) {
    push(open.from, open.to, OPTIONAL_END.has(open.tag) ? "warning" : "error", "unclosed", { tag: open.tag });
  }

  // style.css with real CSS in it, but no link to it.
  const css = files.find((f) => f.name === "style.css");
  if (
    css !== undefined &&
    blankComments(css.content).trim() !== "" &&
    !/<link\b[^>]*href\s*=\s*["']?\.?\/?style\.css/i.test(html)
  ) {
    const head = /<\/head>/i.exec(html);
    const at = head?.index ?? 0;
    push(at, at + (head ? head[0].length : 0), "info", "css-not-linked");
  }
}

function lintCss(file: CodeFile, html: string, push: Push) {
  const css = blankComments(file.content);
  const rules = parseStylesheet(file.content);
  let page: Page | null = null;
  for (const rule of rules) {
    if (!rule.closed) {
      push(rule.open, rule.open + 1, "error", "unclosed-block");
    }
    if (rule.selector.includes("}")) {
      // A stray } before this rule glued itself to the selector.
      const at = rule.selectorStart + rule.selector.indexOf("}");
      push(at, at + 1, "error", "stray-close", { tag: "}" });
    } else if (selectorError(rule.selector) !== null) {
      push(rule.selectorStart, rule.selectorEnd, "error", "invalid-selector", { selector: rule.selector });
    } else if (!rule.selector.includes(":") && rule.media.length === 0) {
      page ??= new Page([{ name: "index.html", content: html }]);
      try {
        if (page.select(rule.selector).length === 0) {
          push(rule.selectorStart, rule.selectorEnd, "warning", "selector-no-match", { selector: rule.selector });
        }
      } catch {
        // Selectors the engine can't run are not the student's problem.
      }
    }
    // Pieces between ; that aren't declarations at all, like `color red`.
    const bodyStart = rule.open + 1;
    const bodyEnd = rule.closed ? rule.close - 1 : rule.close;
    let partStart = bodyStart;
    for (let i = bodyStart; i <= bodyEnd; i++) {
      if (i === bodyEnd || css[i] === ";") {
        const part = css.slice(partStart, i);
        if (part.trim() !== "" && !part.includes(":") && !part.includes("{")) {
          const lead = part.length - part.trimStart().length;
          push(partStart + lead, partStart + part.trimEnd().length, "error", "missing-colon");
        }
        partStart = i + 1;
      }
    }
    for (const declaration of rule.declarations) {
      const { property, value } = declaration;
      const propertyEnd = declaration.start + property.length;
      // `color: red⏎ background: blue` — the next line got swallowed.
      const swallowed = /\n\s*-?[a-z][a-z-]*\s*:/i.exec(value);
      if (swallowed !== null) {
        const lineEnd = css.indexOf("\n", declaration.start);
        push(lineEnd - 1, lineEnd, "error", "missing-semicolon");
        continue;
      }
      if (!CSS_PROPERTIES.has(property) && !property.startsWith("-") && !property.startsWith("--")) {
        const s = closest(property, CSS_PROPERTIES);
        push(declaration.start, propertyEnd, "error", "unknown-property", s ? { prop: property, s } : { prop: property });
        continue;
      }
      if (!isValidDeclaration(property, value)) {
        const unitless = /^\d*\.?\d+$/.test(value.trim()) && value.trim() !== "0";
        push(declaration.start, declaration.end, "error", "invalid-value", {
          prop: property,
          value,
          ...(unitless ? { unit: value.trim() } : {}),
        });
      }
    }
  }
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Every mistake in the files, in file order. Messages in the student's language. */
export function findMistakes(files: CodeFile[], assets: SandboxAsset[], locale: Locale): Mistake[] {
  const mistakes: Mistake[] = [];
  const html = files.find((f) => f.name === "index.html")?.content ?? "";
  for (const file of files) {
    const push: Push = (from, to, severity, code, params = {}) => {
      mistakes.push({
        file: file.name,
        from: Math.max(0, from),
        to: Math.max(from, to),
        line: lineOf(file.content, from),
        severity,
        code,
        message: say(code, locale, params),
      });
    };
    if (file.name.endsWith(".html")) lintHtml(file, files, assets, push);
    else if (file.name.endsWith(".css")) lintCss(file, html, push);
  }
  return mistakes.sort((a, b) => a.file.localeCompare(b.file) || ORDER[a.severity] - ORDER[b.severity] || a.from - b.from);
}
