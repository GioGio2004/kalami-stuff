import { describe, expect, it } from "vitest";
import { parseWordList } from "./wordList";

describe("parseWordList", () => {
  it("splits each line on a tab, a spaced dash or a colon", () => {
    expect(
      parseWordList(
        "HTML - The language that gives a page its structure\nBrowser – Draws pages\n\nServer: Answers requests\nCSS\tStyles a page\ne-mail — Letters by internet\nDomain name",
      ),
    ).toEqual([
      { answer: "HTML", clue: "The language that gives a page its structure" },
      { answer: "Browser", clue: "Draws pages" },
      { answer: "Server", clue: "Answers requests" },
      { answer: "CSS", clue: "Styles a page" },
      { answer: "e-mail", clue: "Letters by internet" },
      { answer: "Domain name", clue: "" },
    ]);
  });

  it("reads Georgian lines", () => {
    expect(parseWordList("ბრაუზერი - ვებგვერდებს ხატავს")).toEqual([{ answer: "ბრაუზერი", clue: "ვებგვერდებს ხატავს" }]);
  });
});
