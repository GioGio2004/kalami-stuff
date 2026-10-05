// Syntax colouring for the code blocks in lessons: HTML, CSS and JavaScript
// (anything else gets the generic rules). A small tokenizer of our own, so the
// static code windows need no editor library; colours are theme tokens
// (globals.css --code-*). Kept free of React so it can be tested on its own.
//
// This folder is copied into the student app by scripts/sync-student.mjs; edit it here.

export type TokenKind =
  | "text"
  | "tag"
  | "attr"
  | "string"
  | "comment"
  | "keyword"
  | "number"
  | "property"
  | "selector"
  | "value"
  | "function"
  | "punct";

export type Token = { kind: TokenKind; text: string };

/** The code as lines of tokens; every character of `code` is in exactly one token, in order. */
export function tokenize(language: string, code: string): Token[][] {
  const lang = language.trim().toLowerCase();
  let tokens: Token[];
  if (lang === "html" || lang === "xml" || lang === "svg" || lang === "vue") tokens = tokenizeHtml(code);
  else if (lang === "css" || lang === "scss" || lang === "less") tokens = tokenizeCss(code);
  else tokens = tokenizeScript(code);
  return splitLines(tokens);
}

/** Tokens broken at newlines, so each line renders on its own (a comment may span lines). */
function splitLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1].push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

/** Joins runs of the same kind, so the output stays small. */
function push(out: Token[], kind: TokenKind, text: string) {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === kind && kind !== "tag" && kind !== "attr") last.text += text;
  else out.push({ kind, text });
}

// --- HTML --------------------------------------------------------------------------------

const ATTR_NAME = /^[^\s"'<>/=]+/;
const TAG_NAME = /^[A-Za-z][\w:-]*/;

function tokenizeHtml(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith("<!--", i)) {
      const end = code.indexOf("-->", i + 4);
      const stop = end === -1 ? code.length : end + 3;
      push(out, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (code.startsWith("<!", i) || code.startsWith("<?", i)) {
      const end = code.indexOf(">", i);
      const stop = end === -1 ? code.length : end + 1;
      push(out, "keyword", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (code[i] === "<" && (code[i + 1] === "/" || TAG_NAME.test(code.slice(i + 1, i + 2)))) {
      // The tag itself.
      const closing = code[i + 1] === "/";
      push(out, "punct", closing ? "</" : "<");
      i += closing ? 2 : 1;
      const name = TAG_NAME.exec(code.slice(i))?.[0] ?? "";
      push(out, "tag", name);
      i += name.length;
      // Attributes until the tag ends.
      while (i < code.length) {
        const space = /^\s+/.exec(code.slice(i))?.[0];
        if (space) {
          push(out, "text", space);
          i += space.length;
          continue;
        }
        if (code.startsWith("/>", i)) {
          push(out, "punct", "/>");
          i += 2;
          break;
        }
        if (code[i] === ">") {
          push(out, "punct", ">");
          i += 1;
          break;
        }
        if (code[i] === "=") {
          push(out, "punct", "=");
          i += 1;
          continue;
        }
        if (code[i] === '"' || code[i] === "'") {
          const quote = code[i];
          const end = code.indexOf(quote, i + 1);
          const stop = end === -1 ? code.length : end + 1;
          push(out, "string", code.slice(i, stop));
          i = stop;
          continue;
        }
        const attr = ATTR_NAME.exec(code.slice(i))?.[0];
        if (attr) {
          push(out, "attr", attr);
          i += attr.length;
          continue;
        }
        push(out, "text", code[i]);
        i += 1;
      }
      // Style and script bodies are code of their own.
      const lower = name.toLowerCase();
      if (!closing && (lower === "style" || lower === "script")) {
        const end = code.toLowerCase().indexOf(`</${lower}`, i);
        const stop = end === -1 ? code.length : end;
        const inner = code.slice(i, stop);
        out.push(...(lower === "style" ? tokenizeCss(inner) : tokenizeScript(inner)));
        i = stop;
      }
      continue;
    }
    // Text until the next tag or comment.
    let end = i + 1;
    while (end < code.length && code[end] !== "<") end++;
    push(out, "text", code.slice(i, end));
    i = end;
  }
  return out;
}

// --- CSS ---------------------------------------------------------------------------------

const CSS_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/;
const CSS_HEX = /^#[0-9a-fA-F]{3,8}\b/;
const CSS_IDENT = /^-?[_a-zA-Z][\w-]*/;

/** At-rules whose block holds rules (selectors) rather than declarations. */
const NESTING_AT_RULES = new Set(["@media", "@supports", "@layer", "@container", "@keyframes", "@scope", "@document"]);

function tokenizeCss(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  // For each open block: does it hold rules (true) or declarations (false)? Top level holds rules.
  const blocks: boolean[] = [];
  let openingRules = false;
  // Inside a declaration block: before the colon it's a property, after it a value.
  let inValue = false;
  while (i < code.length) {
    const depth = blocks.length;
    const inRules = depth === 0 || blocks[depth - 1];
    const rest = code.slice(i);
    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(out, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    const space = /^\s+/.exec(rest)?.[0];
    if (space) {
      push(out, "text", space);
      i += space.length;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const end = code.indexOf(ch, i + 1);
      const stop = end === -1 ? code.length : end + 1;
      push(out, "string", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "{") {
      blocks.push(openingRules);
      openingRules = false;
      inValue = false;
      push(out, "punct", ch);
      i++;
      continue;
    }
    if (ch === "}") {
      blocks.pop();
      openingRules = false;
      inValue = false;
      push(out, "punct", ch);
      i++;
      continue;
    }
    if (ch === ";") {
      openingRules = false;
      inValue = false;
      push(out, "punct", ch);
      i++;
      continue;
    }
    if (ch === "@") {
      const word = /^@[\w-]*/.exec(rest)?.[0] ?? "@";
      openingRules = NESTING_AT_RULES.has(word.toLowerCase());
      push(out, "keyword", word);
      i += word.length;
      continue;
    }
    if (inRules) {
      // Selector text (or an at-rule's prelude) runs until a brace, a comma, or a comment.
      let end = i;
      while (end < code.length && !"{},;".includes(code[end]) && !code.startsWith("/*", end) && code[end] !== "\n") end++;
      if (end > i) {
        push(out, "selector", code.slice(i, end));
        i = end;
        continue;
      }
      push(out, "punct", ch);
      i++;
      continue;
    }
    if (ch === ":" && !inValue) {
      inValue = true;
      push(out, "punct", ch);
      i++;
      continue;
    }
    if (!inValue) {
      const name = CSS_IDENT.exec(rest)?.[0];
      if (name) {
        push(out, "property", name);
        i += name.length;
        continue;
      }
      push(out, "punct", ch);
      i++;
      continue;
    }
    // A value.
    if (rest.startsWith("!important")) {
      push(out, "keyword", "!important");
      i += 10;
      continue;
    }
    const hex = CSS_HEX.exec(rest)?.[0];
    if (hex) {
      push(out, "number", hex);
      i += hex.length;
      continue;
    }
    const num = CSS_NUMBER.exec(rest)?.[0];
    if (num && !/^-?[_a-zA-Z]/.test(num)) {
      push(out, "number", num);
      i += num.length;
      continue;
    }
    const ident = CSS_IDENT.exec(rest)?.[0];
    if (ident) {
      const fn = code[i + ident.length] === "(";
      push(out, fn ? "function" : "value", ident);
      i += ident.length;
      continue;
    }
    push(out, "punct", ch);
    i++;
  }
  return out;
}

// --- JavaScript and everything else ---------------------------------------------------------

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue new class extends " +
    "import export from default try catch finally throw typeof instanceof in of this super async await " +
    "yield static get set null undefined true false void delete with debugger enum interface type implements " +
    "public private protected readonly as def elif lambda pass raise not and or is None True False print"
  ).split(" "),
);
const SCRIPT_NUMBER = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*\.?\d*(?:e[+-]?\d+)?)/;
const SCRIPT_IDENT = /^[$_\p{L}][$_\p{L}\p{N}]*/u;

function tokenizeScript(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    if (rest.startsWith("//") || rest.startsWith("#!")) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push(out, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(out, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let end = i + 1;
      while (end < code.length && code[end] !== ch) {
        if (code[end] === "\\") end++;
        if (ch !== "`" && code[end] === "\n") break;
        end++;
      }
      const stop = Math.min(code.length, end + 1);
      push(out, "string", code.slice(i, stop));
      i = stop;
      continue;
    }
    const space = /^\s+/.exec(rest)?.[0];
    if (space) {
      push(out, "text", space);
      i += space.length;
      continue;
    }
    const num = SCRIPT_NUMBER.exec(rest)?.[0];
    if (num) {
      push(out, "number", num);
      i += num.length;
      continue;
    }
    const ident = SCRIPT_IDENT.exec(rest)?.[0];
    if (ident) {
      let kind: TokenKind = "text";
      if (KEYWORDS.has(ident)) kind = "keyword";
      else if (/^\s*\(/.test(code.slice(i + ident.length))) kind = "function";
      push(out, kind, ident);
      i += ident.length;
      continue;
    }
    push(out, "punct", ch);
    i++;
  }
  return out;
}
