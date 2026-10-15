// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { crosswordGrid, layoutCrossword } from "@/lib/crossword";
import { crosswordPdfBytes, type CrosswordPdf } from "./pdf";

const fonts = async (file: string) => {
  const bytes = await readFile(new URL(`../../public/fonts/crossword/${file}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

function sample(entries: [string, string, string][]): CrosswordPdf {
  const list = entries.map(([id, answer, clue]) => ({ id, answer, clue }));
  const layout = layoutCrossword(list);
  const { cells, words, solution } = crosswordGrid(list, layout);
  return { title: "Words of the web", subtitle: "Web basics · Week 1", width: layout.width, height: layout.height, cells, words, solution };
}

const WEB: [string, string, string][] = [
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
];

describe("crossword PDF", () => {
  it("is the puzzle on one page, and the answer key on the next for teachers", async () => {
    const teacher = sample(WEB);
    const withKey = await PDFDocument.load(await crosswordPdfBytes(teacher, fonts));
    expect(withKey.getPageCount()).toBe(2);
    expect(withKey.getTitle()).toBe("Words of the web");
    const student = await PDFDocument.load(await crosswordPdfBytes({ ...teacher, solution: undefined }, fonts));
    expect(student.getPageCount()).toBe(1);
    if (process.env.CROSSWORD_PDF_OUT) await writeFile(process.env.CROSSWORD_PDF_OUT, await crosswordPdfBytes(teacher, fonts));
  });

  it("sets Georgian and carries long clue lists over to another page", async () => {
    const long = "ეს არის ძალიან გრძელი მინიშნება, რომელიც რამდენიმე ხაზზე უნდა გადავიდეს, რომ ყველაფერი ჩაეტიოს გვერდზე ";
    const ka = sample([
      ["a", "კომპიუტერი", long.repeat(3)],
      ["b", "ბრაუზერი", long.repeat(3)],
      ["c", "სერვერი", long.repeat(3)],
      ["d", "ბმული", long.repeat(3)],
      ["e", "კოდი", long.repeat(3)],
      ["f", "პროგრამა", long.repeat(3)],
    ]);
    const doc = await PDFDocument.load(await crosswordPdfBytes({ ...ka, solution: undefined }, fonts));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
