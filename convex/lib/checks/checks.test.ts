import { describe, expect, test } from "vitest";
import {
  fill,
  fillRule,
  normalizeValue,
  parseStylesheet,
  pickValues,
  runChecks,
  sampleValues,
  selectorError,
  type CheckRule,
} from "./index";

const html = (body: string, head = '<link rel="stylesheet" href="style.css">') =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

/** A rule without its id and label, keeping the union apart. */
type RuleBody = CheckRule extends infer R ? (R extends CheckRule ? Omit<R, "id" | "label"> : never) : never;

function check(body: string, css: string, rule: RuleBody, head?: string) {
  const [result] = runChecks(
    [
      { name: "index.html", content: html(body, head) },
      { name: "style.css", content: css },
    ],
    [{ id: "r", label: "rule", ...rule } as CheckRule],
  );
  return result;
}

describe("values", () => {
  test("colours compare in any notation", () => {
    expect(normalizeValue("#F00")).toBe("rgb(255, 0, 0)");
    expect(normalizeValue("red")).toBe("rgb(255, 0, 0)");
    expect(normalizeValue("rgb(255 0 0)")).toBe("rgb(255, 0, 0)");
    expect(normalizeValue("hsl(0, 100%, 50%)")).toBe("rgb(255, 0, 0)");
    expect(normalizeValue("rgba(0,0,0,.5)")).toBe("rgba(0, 0, 0, 0.5)");
  });

  test("zero lengths and spacing", () => {
    expect(normalizeValue("0px  auto")).toBe("0 auto");
    expect(normalizeValue("1px solid #333")).toBe("1px solid rgb(51, 51, 51)");
  });
});

describe("parser", () => {
  test("an unclosed comment runs to the end", () => {
    expect(parseStylesheet("a { color: red } /* note\n b { color: blue }")).toHaveLength(1);
  });

  test("a missing semicolon swallows the next declaration", () => {
    const [rule] = parseStylesheet("h1 { color: red\n background: blue; }");
    expect(rule.declarations).toEqual([
      { property: "color", value: "red\n background: blue", important: false, start: 5, end: 33 },
    ]);
  });

  test("offsets survive comments", () => {
    const css = "/* hi */ .a {\n  color: red;\n}";
    const [rule] = parseStylesheet(css);
    expect(css.slice(rule.selectorStart, rule.selectorEnd)).toBe(".a");
    const [decl] = rule.declarations;
    expect(css.slice(decl.start, decl.end)).toBe("color: red");
  });

  test("variants: same student, same values; placeholders filled everywhere", () => {
    const variables = [{ name: "color", values: ["red", "teal", "navy"] }];
    const a = pickValues(variables, "user1:task1", { firstName: "ანა" });
    expect(pickValues(variables, "user1:task1", { firstName: "ანა" })).toEqual(a);
    expect(variables[0].values).toContain(a.color);
    const rule = fillRule(
      { id: "x", label: "h1 is {{color}}", type: "css", selector: "h1", property: "color", equals: "{{color}}" },
      sampleValues(variables, 1),
    );
    expect(rule).toMatchObject({ label: "h1 is teal", equals: "teal" });
    expect(fill("Hi {{student.firstName}} {{ nope }}", a)).toBe("Hi ანა {{ nope }}");
  });

  test("media blocks keep their condition", () => {
    const rules = parseStylesheet("@media (max-width: 600px) { nav { display: none } }");
    expect(rules[0].media).toEqual(["(max-width: 600px)"]);
  });

  test("selector errors", () => {
    expect(selectorError("nav > ul li")).toBeNull();
    expect(selectorError("nav >")).not.toBeNull();
  });
});

describe("structure rules", () => {
  test("exists, count and not_exists", () => {
    const body = "<nav><ul><li>A</li><li>B</li><li>C</li></ul></nav>";
    expect(check(body, "", { type: "exists", selector: "nav" }).passed).toBe(true);
    expect(check(body, "", { type: "count", selector: "nav li", min: 3, max: 3 }).passed).toBe(true);
    expect(check(body, "", { type: "count", selector: "nav li", min: 4 })).toMatchObject({
      passed: false,
      detail: "Found 3, need at least 4.",
    });
    expect(check(body, "", { type: "not_exists", selector: "table" }).passed).toBe(true);
  });

  test("text contains, case-insensitive by default", () => {
    expect(check("<h1>  Hello,   Nino </h1>", "", { type: "text", selector: "h1", contains: "hello, nino" }).passed).toBe(true);
    expect(check("<h1>Hello</h1>", "", { type: "text", selector: "h1", equals: "Hello Nino" }).passed).toBe(false);
  });

  test("attributes on every match", () => {
    const body = '<img src="a.png" alt="A cat"><img src="b.png">';
    expect(check(body, "", { type: "attr", selector: "img", attribute: "alt" })).toMatchObject({ passed: false });
    expect(check(body, "", { type: "attr", selector: "img", attribute: "alt", every: false }).passed).toBe(true);
  });

  test("linked stylesheet", () => {
    expect(check("", "", { type: "linked", href: "style.css" }).passed).toBe(true);
    expect(check("", "", { type: "linked", href: "style.css" }, "<title>x</title>").passed).toBe(false);
  });
});

describe("css rules", () => {
  test("a forgotten <link> means the CSS doesn't apply", () => {
    const rule = { type: "css", selector: "h1", property: "color", equals: "red" } as const;
    expect(check("<h1>Hi</h1>", "h1 { color: red }", rule).passed).toBe(true);
    expect(check("<h1>Hi</h1>", "h1 { color: red }", rule, "<title>x</title>").passed).toBe(false);
  });

  test("specificity beats order, !important beats specificity", () => {
    const body = '<p class="note" id="first">x</p>';
    const rule = { type: "css", selector: "p", property: "color", equals: "blue" } as const;
    expect(check(body, "#first { color: blue } .note { color: red }", rule).passed).toBe(true);
    expect(check(body, ".note { color: red } p { color: blue }", rule).passed).toBe(false);
    expect(check(body, ".note { color: red } p { color: blue !important }", rule).passed).toBe(true);
    expect(check('<p style="color: blue" class="note">x</p>', ".note { color: red }", rule).passed).toBe(true);
  });

  test("colour is inherited from the parent", () => {
    const rule = { type: "css", selector: "nav a", property: "color", equals: "#ffffff" } as const;
    // Links have their own browser colour, so setting it on nav isn't enough.
    expect(check('<nav><a href="#">x</a></nav>', "nav { color: white }", rule).passed).toBe(false);
    expect(check('<nav><span>x</span></nav>', "nav { color: white }", { ...rule, selector: "nav span" }).passed).toBe(true);
    expect(check('<nav><a href="#">x</a></nav>', "nav a { color: white }", rule).passed).toBe(true);
  });

  test("links are underlined until the student removes it", () => {
    const rule = { type: "css", selector: "a", property: "text-decoration", equals: "none" } as const;
    expect(check('<a href="#">x</a>', "", rule).passed).toBe(false);
    expect(check('<a href="#">x</a>', "a { text-decoration: none; }", rule).passed).toBe(true);
  });

  test("invalid declarations are dropped like in browsers", () => {
    const rule = { type: "css", selector: ".card", property: "display", equals: "flex" } as const;
    expect(check('<div class="card"></div>', ".card { display: flex; display: flexbox; }", rule).passed).toBe(true);
    expect(check('<div class="card"></div>', ".card { display: flexbox; }", rule)).toMatchObject({
      passed: false,
      detail: "`display` is `block`.",
    });
    const width = { type: "css", selector: ".card", property: "width", equals: "100px" } as const;
    expect(check('<div class="card"></div>', ".card { width: 100; }", width).passed).toBe(false);
  });

  test("shorthands in either direction", () => {
    const body = '<div class="box"></div>';
    const margin = { type: "css", selector: ".box", property: "margin", equals: "0 auto" } as const;
    expect(check(body, ".box { margin: 0px auto 0 auto; }", margin).passed).toBe(true);
    expect(check(body, ".box { margin-left: auto; margin-right: auto; }", margin).passed).toBe(true);
    const left = { type: "css", selector: ".box", property: "margin-left", equals: "auto" } as const;
    expect(check(body, ".box { margin: 10px auto; }", left).passed).toBe(true);
    const border = { type: "css", selector: ".box", property: "border", equals: "2px solid #333" } as const;
    expect(check(body, ".box { border: solid #333333 2px; }", border).passed).toBe(true);
    const bg = { type: "css", selector: ".box", property: "background-color", equals: "teal" } as const;
    expect(check(body, ".box { background: #008080; }", bg).passed).toBe(true);
    const flex = { type: "css", selector: ".box", property: "flex", equals: "1" } as const;
    expect(check(body, ".box { flex: 1 1 0%; }", flex).passed).toBe(true);
  });

  test("media queries at a chosen width", () => {
    const css = "nav { display: flex } @media (max-width: 600px) { nav { display: none } }";
    const desktop = { type: "css", selector: "nav", property: "display", equals: "flex" } as const;
    expect(check("<nav></nav>", css, desktop).passed).toBe(true);
    expect(check("<nav></nav>", css, { ...desktop, equals: "none", viewport: 375 }).passed).toBe(true);
  });

  test("oneOf, every and selectors that match nothing", () => {
    const rule = { type: "css", selector: ".card", property: "display", oneOf: ["flex", "grid"] } as const;
    expect(check('<div class="card"></div><div class="card"></div>', ".card { display: grid }", rule).passed).toBe(true);
    expect(
      check('<div class="card"></div><div class="card"></div>', ".card:first-child { display: grid }", rule).passed,
    ).toBe(false);
    expect(check("<p></p>", "", rule)).toMatchObject({ passed: false, detail: "Nothing on the page matches `.card`." });
  });

  test(":hover rules don't count for the page at rest", () => {
    const rule = { type: "css", selector: "a", property: "color", equals: "red" } as const;
    expect(check('<a href="#">x</a>', "a:hover { color: red }", rule).passed).toBe(false);
  });

  test("a broken rule fails alone", () => {
    const results = runChecks(
      [{ name: "index.html", content: html("<nav></nav>") }],
      [
        { id: "bad", label: "bad", type: "exists", selector: "nav >" },
        { id: "good", label: "good", type: "exists", selector: "nav" },
      ],
    );
    expect(results.map((r) => r.passed)).toEqual([false, true]);
  });
});
