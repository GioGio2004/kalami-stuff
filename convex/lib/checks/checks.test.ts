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

describe("browser agreement (2026-11-05 fixes)", () => {
  const css = (property: string, equals: string, selector = ".x") => ({ type: "css", selector, property, equals }) as const;
  const div = '<div class="x"><p class="c">x</p></div>';

  test.each([
    ["font shorthand weight", ".x { font: bold 20px Arial }", css("font-weight", "bold")],
    ["font shorthand size", ".x { font: italic 20px/1.5 Arial }", css("font-size", "20px")],
    ["700 is bold", ".x { font-weight: 700 }", css("font-weight", "bold")],
    ["var()", ":root { --main: red } .x { color: var(--main) }", css("color", "red")],
    ["var() fallback", ".x { color: var(--nope, teal) }", css("color", "teal")],
    ["custom property inherited", ":root { --gap: 4px }", css("--gap", "4px")],
    ["flex-flow", ".x { flex-flow: column wrap }", css("flex-direction", "column")],
    ["place-items", ".x { place-items: center }", css("align-items", "center")],
    ["grid-gap", ".x { grid-gap: 10px }", css("gap", "10px")],
    ["border 0 is none", ".x { border: 0 }", css("border", "none")],
    ["background repeat", ".x { background: url(a.png) center/cover no-repeat }", css("background-repeat", "no-repeat")],
    ["background size", ".x { background: url(a.png) center/cover no-repeat }", css("background-size", "cover")],
    ["background position", ".x { background: url(a.png) center/cover no-repeat }", css("background-position", "50% 50%")],
    ["border-radius corner", ".x { border-radius: 10px }", css("border-top-left-radius", "10px")],
    ["overflow", ".x { overflow: hidden }", css("overflow-x", "hidden")],
    ["inset", ".x { position: absolute; inset: 0 }", css("top", "0")],
    ["transition duration", ".x { transition: color 300ms ease }", css("transition-duration", "0.3s")],
    ["animation name", ".x { animation: spin 2s linear infinite }", css("animation-name", "spin")],
    ["animation count", ".x { animation: spin 2s linear infinite }", css("animation-iteration-count", "infinite")],
    ["font-family quotes", '.x { font-family: "Open Sans", Arial }', css("font-family", "Open Sans, Arial")],
    ["8-digit hex", ".x { color: rgba(255, 0, 0, 0.5) }", css("color", "#ff000080")],
    ["repeat()", ".x { grid-template-columns: repeat(3, 1fr) }", css("grid-template-columns", "1fr 1fr 1fr")],
    ["[class=] doesn't outrank two classes", ".x .c { color: blue } [class=c] { color: red }", css("color", "blue", ".c")],
    ["<!-- --> in CSS", "<!-- .x { color: red } -->", css("color", "red")],
    ["@supports", "@supports (display: grid) { .x { display: grid } }", css("display", "grid")],
    ["@layer loses to unlayered", "@layer base { .x { color: red } } div { color: blue }", css("color", "blue")],
    ["nesting", ".x { color: red; .c { color: blue } }", css("color", "blue", ".c")],
    ["nesting with &", ".x { & > .c { color: blue } padding: 4px }", css("padding", "4px")],
    ["range media", "@media (300px <= width <= 2000px) { .x { color: red } }", css("color", "red")],
    ["default colour", "", css("color", "black")],
  ])("%s", (_, sheet, rule) => {
    expect(check(div, sheet, rule)).toMatchObject({ passed: true });
  });

  test("[id=x] counts like a class, #x like an id", () => {
    const body = '<div class="card"><p id="t" class="title">x</p></div>';
    const rule = { type: "css", selector: "p", property: "color", equals: "blue" } as const;
    expect(check(body, ".card .title { color: blue } [id=t] { color: red }", rule).passed).toBe(true);
    expect(check(body, ".card .title { color: red } #t { color: blue }", rule).passed).toBe(true);
  });

  test.each([
    ["one bad selector drops the list", ".x, p:hoverr { color: red }", css("color", "red")],
    ["unitless padding is dropped", ".x { padding-top: 10 }", css("padding-top", "10")],
    ["unitless gap is dropped", ".x { gap: 10 }", css("row-gap", "10")],
  ])("%s", (_, sheet, rule) => {
    expect(check(div, sheet, rule)).toMatchObject({ passed: false });
  });

  test("media attributes, leading slashes and @import", () => {
    const rule = css("display", "none");
    expect(check(div, "", rule, '<style media="print">.x { display: none }</style>').passed).toBe(false);
    expect(check(div, ".x { display: none }", rule, '<link rel="stylesheet" href="/style.css">').passed).toBe(true);
    const [imported] = runChecks(
      [
        { name: "index.html", content: html(div) },
        { name: "style.css", content: "@import url('more.css');" },
        { name: "more.css", content: ".x { display: none }" },
      ],
      [{ id: "r", label: "r", ...rule }],
    );
    expect(imported.passed).toBe(true);
  });

  test("text reads like a person: <br> breaks words, <style> isn't text", () => {
    expect(check("<p>Hello<br>World</p>", "", { type: "text", selector: "p", equals: "Hello World" }).passed).toBe(true);
    expect(
      check("<main><style>p{}</style><p>Hi</p></main>", "", { type: "text", selector: "main", equals: "Hi" }).passed,
    ).toBe(true);
  });

  test("attributes browsers read loosely", () => {
    expect(check("<input TYPE=EMAIL>", "", { type: "attr", selector: "input", attribute: "type", equals: "email" }).passed).toBe(true);
    expect(
      check('<a href="./about.html">x</a>', "", { type: "attr", selector: "a", attribute: "href", equals: "about.html" }).passed,
    ).toBe(true);
  });
});

describe("states and animation", () => {
  const body = '<nav><a href="#" class="link">x</a></nav><div class="card"><h2 class="title">T</h2></div>';

  test("hover styles can be checked", () => {
    const sheet = "a { color: black; transition: color .3s } a:hover { color: red } .card:hover .title { color: teal }";
    expect(check(body, sheet, { type: "css", selector: "a:hover", property: "color", equals: "red" }).passed).toBe(true);
    expect(check(body, sheet, { type: "css", selector: "a", property: "color", equals: "black" }).passed).toBe(true);
    expect(check(body, sheet, { type: "css", selector: ".card:hover .title", property: "color", equals: "teal" }).passed).toBe(true);
    expect(check(body, "", { type: "css", selector: "a:hover", property: "color", equals: "red" }).passed).toBe(false);
    expect(check(body, sheet, { type: "css", selector: "a", property: "transition-property", equals: "color" }).passed).toBe(true);
  });

  test("focus and pseudo-elements", () => {
    const sheet = "input:focus { outline: 2px solid red } .title::before { content: '★' }";
    const form = "<input>" + body;
    expect(check(form, sheet, { type: "css", selector: "input:focus", property: "outline-style", equals: "solid" }).passed).toBe(true);
    expect(check(form, sheet, { type: "css", selector: ".title::before", property: "content", equals: "'★'" }).passed).toBe(true);
  });

  test("keyframes and animations", () => {
    const sheet = "@keyframes spin { to { transform: rotate(360deg) } } .card { animation: spin 2s linear infinite }";
    expect(check(body, sheet, { type: "keyframes", name: "spin", property: "transform" }).passed).toBe(true);
    expect(check(body, sheet, { type: "keyframes", name: "spin", property: "opacity" }).passed).toBe(false);
    expect(check(body, sheet, { type: "animation", selector: ".card", property: "transform" }).passed).toBe(true);
    expect(check(body, sheet, { type: "animation", selector: ".title" })).toMatchObject({ passed: false });
    expect(check(body, ".card { animation: spin 2s }", { type: "animation", selector: ".card" })).toMatchObject({
      passed: false,
      detail: "The animation `spin` has no `@keyframes spin`.",
    });
    expect(check(body, "@keyframes spin {} .card { animation-name: spin }", { type: "animation", selector: ".card" })).toMatchObject({
      passed: false,
      detail: "The animation's duration is 0, so it never plays.",
    });
  });

  test("states only in css checks", () => {
    expect(selectorError("a:hover")).toBeNull();
    expect(selectorError("a:hover", { states: false })).not.toBeNull();
    expect(selectorError("p:hoverr")).not.toBeNull();
    expect(selectorError("p::before span")).not.toBeNull();
  });
});

describe("speed", () => {
  test("sibling chains stay linear", () => {
    const body = "<p>x</p>".repeat(400);
    const t = performance.now();
    const result = check(body, ".zz ~ p ~ p ~ p ~ p ~ p ~ p { color: red }", { type: "css", selector: "p", property: "color", equals: "red" });
    expect(result.passed).toBe(false);
    expect(performance.now() - t).toBeLessThan(250);
  });

  test("a hostile page stops at the work budget instead of hanging", () => {
    const body = "<div>".repeat(300) + "x" + "</div>".repeat(300);
    const sheet = Array.from({ length: 1200 }, (_, i) => `div:nth-child(${i + 1}n) div div div { color: red }`).join("\n");
    const t = performance.now();
    check(body, sheet, { type: "exists", selector: "div" });
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
