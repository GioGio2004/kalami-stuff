import { describe, expect, test } from "vitest";
import { findMistakes } from "./lint";

const page = (body: string, head = '<link rel="stylesheet" href="style.css">') =>
  `<!DOCTYPE html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>`;

function mistakes(html: string, css = "", locale: "ka" | "en" = "en") {
  return findMistakes(
    [
      { name: "index.html", content: html },
      { name: "style.css", content: css },
    ],
    [{ name: "cat.jpg", url: "https://ik.imagekit.io/x/cat.jpg" }],
    locale,
  ).map((m) => ({ file: m.file, line: m.line, code: m.code, message: m.message }));
}

describe("mistake finder", () => {
  test("a clean page has nothing to say", () => {
    expect(mistakes(page('<div class="card"><img src="cat.jpg" alt="A cat"></div>'), ".card { display: flex; }")).toEqual([]);
  });

  test("CSS typos, bad values, missing semicolons and colons", () => {
    const css = ".card {\n  backround-color: red;\n  display: flexbox;\n  width: 100;\n  color: red\n  margin: 0;\n  padding 4px;\n}";
    const found = mistakes(page('<div class="card"></div>'), css);
    expect(found).toEqual([
      expect.objectContaining({ code: "unknown-property", line: 2, message: '"backround-color" isn\'t a CSS property. Did you mean background-color?' }),
      expect.objectContaining({ code: "invalid-value", line: 3 }),
      expect.objectContaining({ code: "invalid-value", line: 4, message: expect.stringContaining("like 100px") }),
      expect.objectContaining({ code: "missing-semicolon", line: 5 }),
      expect.objectContaining({ code: "missing-colon", line: 7 }),
    ]);
  });

  test("HTML: unclosed, misnested, unknown tags, dots in classes, missing images", () => {
    const html = page('<div class=".card">\n<p>Hi <strong>there</p>\n<imge src="dog.jpg">\n<img src="dog.jpg" alt="x">');
    const codes = mistakes(html).map((m) => m.code);
    expect(codes).toEqual(["unclosed", "misnested", "unknown-tag", "missing-image", "class-dot"]);
  });

  test("CSS that isn't linked, and selectors that match nothing", () => {
    const found = mistakes(page("<h1>Hi</h1>", "<title>x</title>"), ".crad { color: red; }");
    expect(found.map((m) => m.code)).toEqual(["css-not-linked", "selector-no-match"]);
  });

  test("Georgian messages", () => {
    const [m] = mistakes(page("<p>x</p>"), "p { colr: red; }", "ka");
    expect(m.message).toBe('"colr" CSS თვისება არ არის. იქნებ color გულისხმობდი?');
  });
});
