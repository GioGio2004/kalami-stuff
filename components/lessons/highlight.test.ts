import { describe, expect, test } from "vitest";
import { tokenize, type Token } from "./highlight";

const flat = (lines: Token[][]) => lines.flat();
const text = (lines: Token[][]) => lines.map((line) => line.map((t) => t.text).join("")).join("\n");
const kinds = (lines: Token[][], kind: Token["kind"]) => flat(lines).filter((t) => t.kind === kind).map((t) => t.text);

describe("tokenize", () => {
  test("every character comes back, in order, whatever the language", () => {
    const samples = [
      ["html", '<table border="1">\n  <caption>Exam timetable</caption>\n</table>'],
      ["css", "a:hover { color: #fff; } /* multi\nline */"],
      ["js", "const x = `a\nb`; // hi\nfoo(1.5)"],
      ["python", "def f():\n    return 'x'  # note"],
      ["", ""],
    ] as const;
    for (const [language, code] of samples) {
      expect(text(tokenize(language, code))).toBe(code);
    }
  });

  test("HTML: tags, attributes, strings and comments; style bodies as CSS", () => {
    const lines = tokenize("html", '<!-- top -->\n<table border="1" class=\'t\'>\n<th>Day</th>\n<style>p { color: red; }</style>');
    expect(kinds(lines, "tag")).toEqual(["table", "th", "th", "style", "style"]);
    expect(kinds(lines, "attr")).toEqual(["border", "class"]);
    expect(kinds(lines, "string")).toEqual(['"1"', "'t'"]);
    expect(kinds(lines, "comment")).toEqual(["<!-- top -->"]);
    expect(kinds(lines, "property")).toEqual(["color"]);
    expect(kinds(lines, "selector")).toEqual(["p "]);
    expect(kinds(lines, "value")).toEqual(["red"]);
    // Text between tags stays text.
    expect(flat(lines).find((t) => t.text === "Day")?.kind).toBe("text");
    expect(lines).toHaveLength(4);
  });

  test("CSS: selectors, properties, values, numbers, functions and at-rules", () => {
    const lines = tokenize("css", "@media (min-width: 40rem) {\n  .box, h1 { margin: 24px 0; background: rgb(1, 2, 3); font-weight: bold !important; }\n}");
    expect(kinds(lines, "keyword")).toEqual(["@media", "!important"]);
    expect(kinds(lines, "selector")).toEqual(["(min-width: 40rem) ", ".box", "h1 "]);
    expect(kinds(lines, "property")).toEqual(["margin", "background", "font-weight"]);
    expect(kinds(lines, "number")).toEqual(["24px", "0", "1", "2", "3"]);
    expect(kinds(lines, "function")).toEqual(["rgb"]);
    expect(kinds(lines, "value")).toEqual(["bold"]);
  });

  test("JavaScript: keywords, strings, comments, numbers and calls", () => {
    const lines = tokenize("javascript", 'const n = count(3) + 0x1f; // sum\nlet s = "a\\"b";\n/* c */ return true');
    expect(kinds(lines, "keyword")).toEqual(["const", "let", "return", "true"]);
    expect(kinds(lines, "function")).toEqual(["count"]);
    expect(kinds(lines, "number")).toEqual(["3", "0x1f"]);
    expect(kinds(lines, "string")).toEqual(['"a\\"b"']);
    expect(kinds(lines, "comment")).toEqual(["// sum", "/* c */"]);
  });

  test("a comment that spans lines is split per line", () => {
    const lines = tokenize("css", "/* one\ntwo */ a {}");
    expect(lines[0]).toEqual([{ kind: "comment", text: "/* one" }]);
    expect(lines[1][0]).toEqual({ kind: "comment", text: "two */" });
  });

  test("unterminated strings and comments don't run past the code", () => {
    expect(text(tokenize("html", '<a href="x'))).toBe('<a href="x');
    expect(text(tokenize("js", "'open"))).toBe("'open");
    expect(text(tokenize("css", "/* open"))).toBe("/* open");
  });
});
