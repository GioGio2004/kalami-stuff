import { describe, expect, it } from "vitest";
import {
  answerLetters,
  arrangeCrossword,
  positionsOf,
  crosswordGrid,
  crosswordProblems,
  crosswordVersion,
  displayLetter,
  enumeration,
  layoutCrossword,
  normalizeLetter,
  type CrosswordEntry,
  type CrosswordLayout,
} from "./index";

const WEB: CrosswordEntry[] = [
  ["html", "HTML", "The language that gives a page its structure"],
  ["css", "CSS", "Styles a page: colours, fonts, layout"],
  ["browser", "Browser", "The program that draws web pages"],
  ["server", "Server", "The computer that answers a request"],
  ["domain", "Domain name", "kalami.space is one"],
  ["link", "Hyperlink", "Click it to go to another page"],
  ["https", "HTTPS", "The padlock protocol"],
  ["tag", "Tag", "<p> is one"],
  ["dns", "DNS", "Turns names into addresses"],
  ["cache", "Cache", "Keeps copies close so pages load faster"],
].map(([id, answer, clue]) => ({ id, answer, clue }));

/** Every rule a valid grid keeps, checked cell by cell. */
function expectValid(entries: CrosswordEntry[], layout: CrosswordLayout, connected = true) {
  const at = new Map<string, { letter: string; dirs: string[] }>();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const p of layout.placements) {
    const letters = answerLetters(byId.get(p.id)!.answer);
    expect(p.row).toBeGreaterThanOrEqual(0);
    expect(p.col).toBeGreaterThanOrEqual(0);
    expect(p.dir === "across" ? p.col + letters.length : p.row + letters.length).toBeLessThanOrEqual(
      p.dir === "across" ? layout.width : layout.height,
    );
    letters.forEach((letter, k) => {
      const key = p.dir === "across" ? `${p.row},${p.col + k}` : `${p.row + k},${p.col}`;
      const cell = at.get(key);
      if (cell) {
        expect(cell.letter).toBe(letter);
        expect(cell.dirs).not.toContain(p.dir);
        cell.dirs.push(p.dir);
      } else {
        at.set(key, { letter, dirs: [p.dir] });
      }
    });
  }
  // Every run of letters in a row or column is exactly one word (no accidental words).
  const runs = (dir: "across" | "down") => {
    const found: string[] = [];
    for (let a = 0; a < (dir === "across" ? layout.height : layout.width); a++) {
      let run = "";
      let start = 0;
      for (let b = 0; b <= (dir === "across" ? layout.width : layout.height); b++) {
        const cell = at.get(dir === "across" ? `${a},${b}` : `${b},${a}`);
        if (cell) {
          if (run === "") start = b;
          run += cell.letter;
        } else {
          if (run.length > 1) found.push(dir === "across" ? `${a},${start}` : `${start},${a}`);
          run = "";
        }
      }
    }
    return found.sort();
  };
  for (const dir of ["across", "down"] as const) {
    expect(runs(dir)).toEqual(layout.placements.filter((p) => p.dir === dir).map((p) => `${p.row},${p.col}`).sort());
  }
  // One connected grid: every placed word crosses another.
  for (const p of layout.placements) {
    const letters = answerLetters(byId.get(p.id)!.answer);
    const crosses = letters.some((_, k) => at.get(p.dir === "across" ? `${p.row},${p.col + k}` : `${p.row + k},${p.col}`)!.dirs.length > 1);
    if (connected && layout.placements.length > 1) expect(crosses).toBe(true);
  }
}

describe("letters", () => {
  it("keeps letters and digits, folds case, drops spaces and hyphens", () => {
    expect(answerLetters("Domain name")).toEqual("domainname".split(""));
    expect(answerLetters("e-mail")).toEqual(["e", "m", "a", "i", "l"]);
    expect(answerLetters("HTML5")).toEqual(["h", "t", "m", "l", "5"]);
    expect(answerLetters("კომპიუტერი")).toHaveLength(10);
    // Georgian capitals (Mtavruli) are the same letters.
    expect(answerLetters("ᲙᲝᲓᲘ")).toEqual(answerLetters("კოდი"));
    expect(answerLetters("Café")).toEqual(["c", "a", "f", "é"]);
  });

  it("reads one typed character, and shows letters in capitals except Georgian", () => {
    expect(normalizeLetter("A")).toBe("a");
    expect(normalizeLetter("კ")).toBe("კ");
    expect(normalizeLetter(" ")).toBeNull();
    expect(displayLetter("a")).toBe("A");
    expect(displayLetter("კ")).toBe("კ");
  });

  it("prints the word lengths after a clue", () => {
    expect(enumeration("Browser")).toBe("(7)");
    expect(enumeration("Domain  name")).toBe("(6, 4)");
    expect(enumeration("e-mail")).toBe("(1-4)");
  });
});

describe("layoutCrossword", () => {
  it("lays every word out in one valid, numbered grid", () => {
    const layout = layoutCrossword(WEB);
    expect(layout.unplaced).toEqual([]);
    expect(layout.placements).toHaveLength(WEB.length);
    expectValid(WEB, layout);
    expect(layout.width).toBeLessThanOrEqual(25);
    expect(layout.height).toBeLessThanOrEqual(25);
    // Numbers run left to right, top to bottom, from 1, shared by an across and a down that start together.
    const starts = [...new Map(layout.placements.map((p) => [`${p.row},${p.col}`, p])).values()].sort((a, b) => a.row - b.row || a.col - b.col);
    expect(starts.map((p) => p.number)).toEqual(starts.map((_, i) => i + 1));
  });

  it("always gives the same grid for the same words", () => {
    expect(layoutCrossword(WEB)).toEqual(layoutCrossword(WEB.map((entry) => ({ ...entry }))));
  });

  it("lays out Georgian words", () => {
    const ka = [
      ["a", "კომპიუტერი", "ითვლის და ინახავს"],
      ["b", "ბრაუზერი", "ვებგვერდებს ხატავს"],
      ["c", "სერვერი", "მოთხოვნას პასუხობს"],
      ["d", "ბმული", "სხვა გვერდზე გადაგიყვანს"],
      ["e", "კოდი", "პროგრამის ტექსტი"],
    ].map(([id, answer, clue]) => ({ id, answer, clue }));
    const layout = layoutCrossword(ka);
    expect(layout.unplaced).toEqual([]);
    expectValid(ka, layout);
  });

  it("lists a word that shares no letter with the others", () => {
    const entries = [...WEB.filter((e) => ["browser", "server", "css", "cache"].includes(e.id)), { id: "x", answer: "Qqqq", clue: "Nothing in common" }];
    const layout = layoutCrossword(entries);
    expect(layout.unplaced).toEqual(["x"]);
    expect(crosswordProblems(entries, layout)).toEqual([expect.stringContaining('entries[4].answer: "Qqqq" doesn\'t fit')]);
  });

  it("stays fast with the most words allowed", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `w${i}`,
      answer: ["networking", "javascript", "stylesheet", "selector", "property", "element", "attribute", "function", "variable", "database"][i % 10] + "abcdefghijklmnopqrst"[i % 20].repeat(1 + (i % 3)),
      clue: "c",
    }));
    const started = Date.now();
    const layout = layoutCrossword(many);
    expect(Date.now() - started).toBeLessThan(500);
    expectValid(many, layout);
  });
});

describe("crosswordGrid", () => {
  it("lists the cells, the clues in order with their cells, and the solution apart", () => {
    const layout = layoutCrossword(WEB);
    const { cells, words, solution } = crosswordGrid(WEB, layout);
    expect(cells).toHaveLength(solution.length);
    expect(words).toHaveLength(WEB.length);
    const domain = words.find((word) => word.id === "domain")!;
    expect(domain.enumeration).toBe("(6, 4)");
    expect(domain.cells.map((i) => solution[i]).join("")).toBe("domainname");
    expect(cells[domain.cells[0]].number).toBe(domain.number);
    // Across clues come first, each list by number.
    const dirs = words.map((word) => word.dir);
    expect(dirs.indexOf("down")).toBeGreaterThan(dirs.lastIndexOf("across"));
  });

  it("changes version when the letters change, not when a clue does", () => {
    const layout = layoutCrossword(WEB);
    const reworded = WEB.map((entry) => (entry.id === "css" ? { ...entry, clue: "Cascading Style Sheets" } : entry));
    expect(crosswordVersion(reworded, layout)).toBe(crosswordVersion(WEB, layout));
    const respelled = WEB.map((entry) => (entry.id === "tag" ? { ...entry, answer: "Tab" } : entry));
    expect(crosswordVersion(respelled, layoutCrossword(respelled))).not.toBe(crosswordVersion(WEB, layout));
  });
});

describe("crosswordProblems", () => {
  it("reports every problem at once, with where it is", () => {
    const problems = crosswordProblems([
      { id: "a", answer: "", clue: "x" },
      { id: "b", answer: "Café!", clue: "" },
      { id: "c", answer: "A", clue: "One letter" },
      { id: "d", answer: "Browser", clue: "ok" },
      { id: "e", answer: "browser", clue: "again" },
    ]);
    expect(problems).toEqual([
      "entries[0].answer: can't be empty.",
      "entries[1].answer: letters, digits, spaces and hyphens only, up to 40 characters.",
      "entries[1].clue: can't be empty.",
      "entries[2].answer: 2 to 21 letters (it has 1).",
      "entries[4].answer: the same word as entries[3].",
    ]);
    expect(crosswordProblems(WEB.slice(0, 3))).toEqual(["entries: 4 to 30 words."]);
    expect(crosswordProblems(WEB)).toEqual([]);
  });
});

describe("arrangeCrossword: words put in place by hand", () => {
  const auto = layoutCrossword(WEB);
  const pinned = () => {
    const at = positionsOf(auto);
    return WEB.map((entry) => ({ ...entry, at: at.get(entry.id) }));
  };

  it("keeps every word where it was put", () => {
    const layout = arrangeCrossword(pinned());
    expect(layout.clashes).toEqual([]);
    expect(layout.placements).toEqual(auto.placements);
  });

  it("lets a word stand on its own in a free spot", () => {
    const entries = pinned().map((entry) =>
      entry.id === "tag" ? { ...entry, at: { row: auto.height + 1, col: 0, dir: "across" as const } } : entry,
    );
    const layout = arrangeCrossword(entries);
    expect(layout.clashes).toEqual([]);
    expect(layout.placements.find((p) => p.id === "tag")).toMatchObject({ row: auto.height + 1, col: 0, dir: "across" });
    expectValid(entries, layout, false);
    expect(crosswordProblems(entries, layout)).toEqual([]);
  });

  it("reports a word put where it runs into another", () => {
    const html = auto.placements.find((p) => p.id === "html")!;
    // Right on top of HTML, the other way round: their letters can't agree everywhere.
    const entries = pinned().map((entry) => (entry.id === "css" ? { ...entry, at: { row: html.row, col: html.col, dir: html.dir } } : entry));
    const layout = arrangeCrossword(entries);
    expect(layout.clashes).toEqual(["css"]);
    expect(crosswordProblems(entries, layout)).toEqual([expect.stringContaining("entries[1].answer: \"CSS\" can't go where it was put")]);
  });

  it("fits words without a place around the ones that have one, and starts the grid at 0, 0", () => {
    const entries = WEB.map((entry, i) => (i === 0 ? { ...entry, at: { row: -4, col: -7, dir: "down" as const } } : entry));
    const layout = arrangeCrossword(entries);
    expect(layout.clashes).toEqual([]);
    expect(layout.unplaced).toEqual([]);
    expectValid(entries, layout, false);
    expect(Math.min(...layout.placements.map((p) => p.row))).toBe(0);
    expect(Math.min(...layout.placements.map((p) => p.col))).toBe(0);
    expect(layout.placements.find((p) => p.id === "html")?.dir).toBe("down");
  });

  it("without any hand-placed word is the automatic layout", () => {
    expect(arrangeCrossword(WEB)).toEqual({ ...auto, clashes: [] });
  });
});
