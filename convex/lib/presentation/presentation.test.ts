import { describe, expect, test } from "vitest";
import {
  deckProblems,
  deckText,
  parseRich,
  plainText,
  sectionNumbers,
  slideLabel,
  slideSteps,
  slideTone,
  tidySlide,
  type Deck,
  type Slide,
} from "./index";

const deck: Deck = {
  theme: "aurora",
  slides: [
    { id: "a", type: "title", title: "How the **web** works", kicker: "Week 1", subtitle: "From a URL to pixels" },
    { id: "b", type: "section", title: "Requests" },
    { id: "c", type: "statement", text: "Every page is a **conversation**." },
    { id: "d", type: "points", title: "Three parts", points: ["A client", "A server", "A protocol"], build: true },
    { id: "e", type: "number", value: 4.8, decimals: 1, suffix: " MB", label: "an average photo" },
    {
      id: "f",
      type: "compare",
      left: { title: "HTTP", points: ["Plain text"] },
      right: { title: "HTTPS", points: ["Encrypted", "Verified"] },
      verdict: "Always **HTTPS**.",
    },
    { id: "g", type: "quote", quote: "The web is for everyone.", author: "Tim Berners-Lee" },
    {
      id: "h",
      type: "code",
      language: "html",
      code: "<a href=\"/\">\n  Home\n</a>",
      highlights: [{ from: 1, note: "The address" }, { from: 2, to: 3 }],
    },
    { id: "i", type: "image", url: "https://example.com/a.png", alt: "A server rack" },
    { id: "j", type: "diagram", layout: "cycle", nodes: [{ label: "Ask" }, { label: "Answer", edge: "200 OK" }, { label: "Draw" }], build: true },
    { id: "k", type: "closing", title: "Thanks", points: ["Pages are conversations"], next: "Next: HTML" },
  ],
};

describe("deck rules", () => {
  test("a good deck has no problems", () => {
    expect(deckProblems(deck)).toEqual([]);
  });

  test("every rule a type can't say is checked, with where it is", () => {
    const bad: Deck = {
      theme: "neon" as Deck["theme"],
      slides: [
        { id: "x", type: "title", title: "   " },
        { id: "x", type: "points", points: ["only one"] },
        { id: "y", type: "statement", text: "word ".repeat(50) },
        { id: "z", type: "number", value: Number.NaN, decimals: 7, label: "" },
        { id: "w", type: "code", language: "cobol", code: "a\nb", highlights: [{ from: 2, to: 5 }] },
        { id: "v", type: "image", url: "http://example.com/a.png", alt: "" },
        { id: "u", type: "diagram", layout: "hub", nodes: [{ label: "A" }, { label: "B" }] },
        { id: "t", type: "compare", left: { title: "", points: [] }, right: { title: "R", points: ["r"] } },
        { id: "bad id!", type: "closing", title: "Bye", points: ["1", "2", "3", "4", "5", "6"] },
      ],
    };
    expect(deckProblems(bad)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("theme: one of ink, paper, aurora, ember, chalk"),
        "slides[0].title: can't be empty.",
        'slides[1].id: "x" is used twice.',
        "slides[1].points: 2 to 6 items.",
        expect.stringContaining("slides[2].text: at most 180 characters"),
        "slides[3].value: a number.",
        "slides[3].decimals: 0 to 3.",
        "slides[3].label: can't be empty.",
        expect.stringContaining("slides[4].language: one of"),
        expect.stringContaining("slides[4].highlights[0]: lines 2-5 aren't in the code (it has 2 lines"),
        "slides[5].url: an https:// link to the image.",
        "slides[5].alt: can't be empty.",
        "slides[6].nodes: 3 to 8 nodes for a hub.",
        "slides[7].left.title: can't be empty.",
        "slides[7].left.points: 1 to 5 items.",
        "slides[8].id: letters, digits, - or _, up to 40.",
        "slides[8].points: 0 to 5 items.",
      ]),
    );
    expect(deckProblems({ theme: "ink", slides: [] })).toEqual(["slides: add at least one slide."]);
  });

  test("lengths count what people see, not the markers", () => {
    const words = "x".repeat(170);
    expect(deckProblems({ theme: "ink", slides: [{ id: "a", type: "statement", text: `**${words}**` }] })).toEqual([]);
  });
});

describe("inline text", () => {
  test("**accent** and `code`; unmatched markers stay", () => {
    expect(parseRich("A **big** idea with `code` and ** a lone one")).toEqual([
      { kind: "text", text: "A " },
      { kind: "accent", text: "big" },
      { kind: "text", text: " idea with " },
      { kind: "code", text: "code" },
      { kind: "text", text: " and ** a lone one" },
    ]);
    expect(plainText("**Every** page is a `<p>`")).toBe("Every page is a <p>");
    expect(parseRich("****")).toEqual([{ kind: "text", text: "****" }]);
  });
});

describe("what the player needs", () => {
  test("builds: points and diagrams with build, code highlights", () => {
    expect(deck.slides.map(slideSteps)).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 0]);
    const auto: Slide = { id: "p", type: "points", points: ["a", "b", "c"] };
    expect(slideSteps(auto)).toBe(0);
  });

  test("sections are numbered in order and accent by default", () => {
    const slides: Slide[] = [
      { id: "a", type: "title", title: "T" },
      { id: "b", type: "section", title: "One" },
      { id: "c", type: "statement", text: "S" },
      { id: "d", type: "section", title: "Two", tone: "default" },
    ];
    expect([...sectionNumbers(slides)]).toEqual([
      [1, 1],
      [3, 2],
    ]);
    expect(slides.map(slideTone)).toEqual(["default", "accent", "default", "default"]);
  });

  test("labels are short plain text", () => {
    expect(slideLabel(deck.slides[0])).toBe("How the web works");
    expect(slideLabel(deck.slides[4])).toBe("4.8 MB an average photo");
    expect(slideLabel(deck.slides[9])).toBe("Ask → Answer → Draw");
    expect(slideLabel({ id: "q", type: "statement", text: "y".repeat(200) })).toHaveLength(80);
  });

  test("the deck's words are searchable", () => {
    const text = deckText(deck);
    for (const word of ["How the web works", "conversation", "Tim Berners-Lee", "200 OK", "Next: HTML", "Encrypted"]) {
      expect(text).toContain(word);
    }
  });
});

describe("tidying", () => {
  test("trims text, drops empty optionals and list items, keeps code indentation", () => {
    expect(
      tidySlide({ id: "a", type: "points", title: "  ", points: [" one ", "", "two"], tone: "default", notes: "\n" }),
    ).toEqual({ id: "a", type: "points", points: ["one", "two"] });
    expect(tidySlide({ id: "b", type: "code", language: " HTML ", code: "\n<p>\r\n  hi\r\n</p>\n\n" })).toEqual({
      id: "b",
      type: "code",
      language: "html",
      code: "<p>\n  hi\n</p>",
    });
    expect(tidySlide({ id: "c", type: "number", value: 3, prefix: " ≈ ", suffix: " ms ", label: "x", decimals: 0 })).toEqual({
      id: "c",
      type: "number",
      value: 3,
      prefix: "≈ ",
      suffix: " ms",
      label: "x",
    });
    // A section's tone "default" is a choice (sections are accent otherwise), so it stays.
    expect(tidySlide({ id: "d", type: "section", title: "S", tone: "default" })).toEqual({ id: "d", type: "section", title: "S", tone: "default" });
  });
});
