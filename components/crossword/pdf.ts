import { displayLetter, type CrosswordCell, type CrosswordWord } from "@/lib/crossword";

// A crossword as a PDF to print: the puzzle (title, a line for a name and
// date, the empty grid, the clues in two columns) and, for teachers, an
// answer key. Made in the browser with pdf-lib, loaded only when someone
// downloads one. Text is set in Noto Sans Georgian (Georgian, Latin and
// accented Latin, public/fonts/crossword, SIL Open Font License), each
// character in the subset that has it, so Georgian and English mix freely.
//
// This folder is copied into the student app by scripts/sync-student.mjs; edit it here.

export type CrosswordPdf = {
  title: string;
  /** Course and week, under the title. */
  subtitle?: string;
  width: number;
  height: number;
  cells: CrosswordCell[];
  words: Pick<CrosswordWord, "id" | "number" | "dir" | "clue" | "enumeration" | "cells">[];
  /** The letters, cell by cell: adds an answer key page. Only teachers have it. */
  solution?: string[];
  /** The answers as written ("Domain name"), by word id, for the key. */
  answers?: Record<string, string>;
};

const SUBSETS = ["georgian", "latin", "latin-ext"] as const;
type Weight = 400 | 700;

/** Where the font files come from: the app's public folder (tests pass their own). */
export type FontSource = (file: string) => Promise<ArrayBuffer>;
const fromPublic: FontSource = async (file) => {
  const response = await fetch(`/fonts/crossword/${file}`);
  if (!response.ok) throw new Error("Couldn't load the PDF fonts. Check the connection and try again.");
  return await response.arrayBuffer();
};

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const INK = { r: 0.08, g: 0.08, b: 0.08 };
const GREY = { r: 0.39, g: 0.39, b: 0.37 };

export async function crosswordPdfBytes(crossword: CrosswordPdf, fonts: FontSource = fromPublic): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(crossword.title);
  doc.setCreator("Kalami");

  // Each subset in both weights: the embedded font to draw with, and fontkit's copy to ask which characters it has.
  type Face = { pdf: Awaited<ReturnType<typeof doc.embedFont>>; has: (codePoint: number) => boolean };
  const faces: Record<Weight, Face[]> = { 400: [], 700: [] };
  for (const weight of [400, 700] as const) {
    for (const subset of SUBSETS) {
      const bytes = new Uint8Array(await fonts(`noto-sans-georgian-${subset}-${weight}-normal.woff`));
      const parsed = fontkit.create(bytes);
      faces[weight].push({ pdf: await doc.embedFont(bytes, { subset: true }), has: (cp) => parsed.hasGlyphForCodePoint(cp) });
    }
  }

  /** The text cut into runs, each in a face that has its characters. */
  const runs = (text: string, weight: Weight) => {
    const out: { face: Face; text: string }[] = [];
    for (const ch of Array.from(text)) {
      const cp = ch.codePointAt(0)!;
      const face = faces[weight].find((f) => f.has(cp)) ?? faces[weight][1];
      const last = out[out.length - 1];
      if (last && last.face === face) last.text += ch;
      else out.push({ face, text: ch });
    }
    return out;
  };
  const measure = (text: string, size: number, weight: Weight) =>
    runs(text, weight).reduce((sum, run) => sum + run.face.pdf.widthOfTextAtSize(run.text, size), 0);
  type Page = ReturnType<typeof doc.addPage>;
  const write = (page: Page, text: string, x: number, y: number, size: number, weight: Weight = 400, color = INK) => {
    let at = x;
    for (const run of runs(text, weight)) {
      page.drawText(run.text, { x: at, y, size, font: run.face.pdf, color: rgb(color.r, color.g, color.b) });
      at += run.face.pdf.widthOfTextAtSize(run.text, size);
    }
    return at;
  };
  /** Greedy word wrap to a width. */
  const wrap = (text: string, size: number, width: number, weight: Weight = 400) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line === "" ? word : `${line} ${word}`;
      if (line !== "" && measure(next, size, weight) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line !== "") lines.push(line);
    return lines;
  };

  const content = PAGE.width - 2 * PAGE.margin;
  const footer = (page: Page) => {
    const text = "Made with Kalami · kalami.space";
    write(page, text, (PAGE.width - measure(text, 7.5, 400)) / 2, 24, 7.5, 400, GREY);
  };

  const heading = (page: Page, title: string, subtitle: string | undefined) => {
    let y = PAGE.height - PAGE.margin - 18;
    for (const line of wrap(title, 20, content, 700).slice(0, 2)) {
      write(page, line, PAGE.margin, y, 20, 700);
      y -= 25;
    }
    if (subtitle) {
      write(page, subtitle, PAGE.margin, y + 4, 9.5, 400, GREY);
      y -= 14;
    }
    return y;
  };

  const drawGrid = (page: Page, top: number, maxHeight: number, letters?: string[]) => {
    const cell = Math.min(26, content / crossword.width, maxHeight / crossword.height);
    const left = PAGE.margin + (content - cell * crossword.width) / 2;
    crossword.cells.forEach((c, i) => {
      const x = left + c.col * cell;
      const y = top - (c.row + 1) * cell;
      page.drawRectangle({ x, y, width: cell, height: cell, borderColor: rgb(INK.r, INK.g, INK.b), borderWidth: 0.8, color: rgb(1, 1, 1) });
      if (c.number !== undefined) write(page, String(c.number), x + cell * 0.08, y + cell * 0.7, Math.max(5, cell * 0.26), 400, GREY);
      const letter = letters?.[i];
      if (letter) {
        const shown = displayLetter(letter);
        const size = cell * 0.52;
        write(page, shown, x + (cell - measure(shown, size, 700)) / 2, y + cell * 0.22, size, 700);
      }
    });
    return top - crossword.height * cell;
  };

  // Clue lists in two columns; a list that runs off the page carries on at the top of the next one.
  const clueColumns = (first: Page, top: number, items: (dir: "across" | "down") => { number: number; text: string; extra?: string }[]) => {
    const gap = 22;
    const columnWidth = (content - gap) / 2;
    const size = 9.5;
    const lineHeight = 12.5;
    const indent = 18;
    const pages: Page[] = [first];
    const pageAt = (index: number) => {
      while (pages.length <= index) {
        const page = doc.addPage([PAGE.width, PAGE.height]);
        footer(page);
        pages.push(page);
      }
      return pages[index];
    };
    for (const dir of ["across", "down"] as const) {
      const x = dir === "across" ? PAGE.margin : PAGE.margin + columnWidth + gap;
      let index = 0;
      let y = top;
      write(pageAt(index), dir === "across" ? "Across" : "Down", x, y, 11.5, 700);
      y -= 17;
      for (const item of items(dir)) {
        const lines = wrap(`${item.text}${item.extra ? ` ${item.extra}` : ""}`, size, columnWidth - indent);
        if (y - lines.length * lineHeight < PAGE.margin) {
          index += 1;
          y = PAGE.height - PAGE.margin;
        }
        const page = pageAt(index);
        const label = String(item.number);
        write(page, label, x + indent - 5 - measure(label, size, 700), y, size, 700);
        for (const line of lines) {
          write(page, line, x + indent, y, size);
          y -= lineHeight;
        }
        y -= 4;
      }
    }
  };

  const ordered = (dir: "across" | "down") => crossword.words.filter((w) => w.dir === dir).sort((a, b) => a.number - b.number);

  // --- The puzzle ---
  const puzzle = doc.addPage([PAGE.width, PAGE.height]);
  footer(puzzle);
  let y = heading(puzzle, crossword.title, crossword.subtitle);
  y -= 6;
  write(puzzle, "Name", PAGE.margin, y, 9.5, 400, GREY);
  puzzle.drawLine({ start: { x: PAGE.margin + 32, y: y - 2 }, end: { x: PAGE.margin + 260, y: y - 2 }, thickness: 0.6, color: rgb(GREY.r, GREY.g, GREY.b) });
  write(puzzle, "Date", PAGE.margin + 290, y, 9.5, 400, GREY);
  puzzle.drawLine({ start: { x: PAGE.margin + 318, y: y - 2 }, end: { x: PAGE.margin + content, y: y - 2 }, thickness: 0.6, color: rgb(GREY.r, GREY.g, GREY.b) });
  y -= 22;
  const gridBottom = drawGrid(puzzle, y, Math.min(400, y - PAGE.margin - 160));
  clueColumns(puzzle, gridBottom - 26, (dir) => ordered(dir).map((w) => ({ number: w.number, text: w.clue, extra: w.enumeration })));

  // --- The answer key ---
  if (crossword.solution) {
    const solution = crossword.solution;
    const key = doc.addPage([PAGE.width, PAGE.height]);
    footer(key);
    let keyY = heading(key, `Answer key: ${crossword.title}`, crossword.subtitle);
    keyY -= 10;
    const bottom = drawGrid(key, keyY, Math.min(400, keyY - PAGE.margin - 160), solution);
    clueColumns(key, bottom - 26, (dir) =>
      ordered(dir).map((w) => ({
        number: w.number,
        text: crossword.answers?.[w.id] ?? w.cells.map((i) => displayLetter(solution[i])).join(""),
      })),
    );
  }

  return await doc.save();
}

/** Makes the PDF and hands it to the browser as a download. */
export async function downloadCrosswordPdf(crossword: CrosswordPdf): Promise<void> {
  const bytes = await crosswordPdfBytes(crossword);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${crossword.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "crossword"}${crossword.solution ? " (with answers)" : ""}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
