// Crosswords: a list of words with clues, and the grid Kalami lays out from
// them. Pure (no React, no database), so the backend, the staff editor's live
// preview and the agents all get the same grid from the same words: nobody,
// person or AI, positions anything. The layout is deterministic: the same
// words always give the same grid.
//
// Letters are compared in lower case (Georgian capitals, Mtavruli, fold to the
// ordinary letters) and shown in capitals except Georgian, which stays as written.
//
// The student app keeps a copy of this folder (scripts/sync-student.mjs); edit it here.

export const CROSSWORD_LIMITS = {
  title: 120,
  entriesMin: 4,
  entries: 30,
  /** Letters in the grid (spaces and hyphens don't count). */
  lettersMin: 2,
  letters: 21,
  /** The answer as typed, with spaces and hyphens. */
  answer: 40,
  clue: 200,
  /** The grid never gets wider or taller than this. */
  side: 25,
} as const;

export type CrosswordDirection = "across" | "down";

/** A word and its clue. `answer` keeps its spaces ("Style sheet"); the grid only has its letters. */
export type CrosswordEntry = { id: string; answer: string; clue: string };

export type CrosswordPlacement = { id: string; row: number; col: number; dir: CrosswordDirection; number: number };

/** Where every word sits. `unplaced`: ids of words that cross nothing and couldn't be fitted. */
export type CrosswordLayout = { width: number; height: number; placements: CrosswordPlacement[]; unplaced: string[] };

/** Where a teacher or an agent put a word by hand: its first letter's square and its direction. */
export type CrosswordPosition = { row: number; col: number; dir: CrosswordDirection };

/** A word with, maybe, the place it was put by hand. */
export type ArrangedEntry = Pick<CrosswordEntry, "id" | "answer"> & { at?: CrosswordPosition };

/** A layout worked out from words, with the hand-placed words that couldn't go where they were put. */
export type ArrangedLayout = CrosswordLayout & { clashes: string[] };

export const CROSSWORD_ENTRY_ID = /^[A-Za-z0-9_-]{1,40}$/;

// --- Letters -------------------------------------------------------------------------------

const LETTER = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;
const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/u;

/** The answer's letters as they go in the grid: lower case, accents kept with their letter, nothing else. */
export function answerLetters(answer: string): string[] {
  const out: string[] = [];
  for (const ch of Array.from(answer.normalize("NFC").toLowerCase())) {
    if (MARK.test(ch) && out.length > 0) out[out.length - 1] += ch;
    else if (LETTER.test(ch)) out.push(ch);
  }
  return out;
}

/** One typed character as a grid letter, or null for anything that isn't a letter or digit. */
export function normalizeLetter(input: string): string | null {
  const letters = answerLetters(input);
  return letters.length > 0 ? letters[letters.length - 1] : null;
}

/** How a grid letter is shown: capitals, except Georgian, which stays as written. */
export function displayLetter(letter: string): string {
  return GEORGIAN.test(letter) ? letter : letter.toUpperCase();
}

/** The lengths printed after a clue: "(9)", "(9, 5)", "(5-6)". */
export function enumeration(answer: string): string {
  const words = answer
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) => answerLetters(part).length)
        .filter((n) => n > 0)
        .join("-"),
    )
    .filter((part) => part !== "");
  return `(${words.join(", ")})`;
}

// --- Laying out the grid ---------------------------------------------------------------------

type Word = { id: string; letters: string[]; index: number };
type Cell = { letter: string; across: boolean; down: boolean };
type Placed = { word: Word; row: number; col: number; dir: CrosswordDirection };

class Board {
  cells = new Map<string, Cell>();
  /** Where each letter is, to find crossings fast. */
  byLetter = new Map<string, [number, number][]>();
  placed: Placed[] = [];
  crossings = 0;
  minR = Infinity;
  maxR = -Infinity;
  minC = Infinity;
  maxC = -Infinity;

  get(r: number, c: number) {
    return this.cells.get(`${r},${c}`);
  }

  /** How many words this placement would cross, or -1 when it can't go there. */
  fit(letters: string[], row: number, col: number, dir: CrosswordDirection, side: number): number {
    const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
    const n = letters.length;
    if (this.get(row - dr, col - dc) || this.get(row + dr * n, col + dc * n)) return -1;
    const top = Math.min(this.minR, row);
    const bottom = Math.max(this.maxR, row + dr * (n - 1));
    const left = Math.min(this.minC, col);
    const right = Math.max(this.maxC, col + dc * (n - 1));
    if (this.placed.length > 0 && (bottom - top + 1 > side || right - left + 1 > side)) return -1;
    let crossings = 0;
    for (let k = 0; k < n; k++) {
      const r = row + dr * k;
      const c = col + dc * k;
      const cell = this.get(r, c);
      if (cell) {
        if (cell.letter !== letters[k] || (dir === "across" ? cell.across : cell.down)) return -1;
        crossings++;
      } else if (dir === "across" ? this.get(r - 1, c) || this.get(r + 1, c) : this.get(r, c - 1) || this.get(r, c + 1)) {
        // A letter right beside another word would spell something nobody wrote.
        return -1;
      }
    }
    return crossings;
  }

  put(word: Word, row: number, col: number, dir: CrosswordDirection, crossings: number) {
    const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
    word.letters.forEach((letter, k) => {
      const r = row + dr * k;
      const c = col + dc * k;
      const key = `${r},${c}`;
      const cell = this.cells.get(key);
      if (cell) {
        cell[dir] = true;
      } else {
        this.cells.set(key, { letter, across: dir === "across", down: dir === "down" });
        const at = this.byLetter.get(letter) ?? [];
        at.push([r, c]);
        this.byLetter.set(letter, at);
      }
      this.minR = Math.min(this.minR, r);
      this.maxR = Math.max(this.maxR, r);
      this.minC = Math.min(this.minC, c);
      this.maxC = Math.max(this.maxC, c);
    });
    this.placed.push({ word, row, col, dir });
    this.crossings += crossings;
  }

  /** A free spot for a word that crosses nothing: below the grid, then to its right. */
  free(word: Word, side: number): { row: number; col: number; dir: CrosswordDirection } | null {
    for (let col = this.minC; col <= this.maxC; col++) {
      if (this.fit(word.letters, this.maxR + 2, col, "across", side) >= 0) return { row: this.maxR + 2, col, dir: "across" };
    }
    for (let row = this.minR; row <= this.maxR; row++) {
      if (this.fit(word.letters, row, this.maxC + 2, "down", side) >= 0) return { row, col: this.maxC + 2, dir: "down" };
    }
    return null;
  }

  /** The best place for the word: most crossings, then the smallest, squarest grid. */
  best(word: Word, side: number): { row: number; col: number; dir: CrosswordDirection; crossings: number } | null {
    let found: { row: number; col: number; dir: CrosswordDirection; crossings: number; score: number } | null = null;
    for (const [i, letter] of word.letters.entries()) {
      for (const [r, c] of this.byLetter.get(letter) ?? []) {
        const cell = this.get(r, c)!;
        for (const dir of ["across", "down"] as const) {
          if (cell[dir]) continue;
          const row = dir === "across" ? r : r - i;
          const col = dir === "across" ? c - i : c;
          const crossings = this.fit(word.letters, row, col, dir, side);
          if (crossings <= 0) continue;
          const height = Math.max(this.maxR, row + (dir === "down" ? word.letters.length - 1 : 0)) - Math.min(this.minR, row) + 1;
          const width = Math.max(this.maxC, col + (dir === "across" ? word.letters.length - 1 : 0)) - Math.min(this.minC, col) + 1;
          const score = crossings * 1_000_000 - height * width * 10 - Math.abs(height - width);
          if (found === null || score > found.score) found = { row, col, dir, crossings, score };
        }
      }
    }
    return found;
  }
}

/** A small seeded random generator, so the same words always give the same grid. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: a short, stable fingerprint of a string. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function tryOrder(order: Word[], side: number): Board {
  const board = new Board();
  board.put(order[0], 0, 0, "across", 0);
  let pending = order.slice(1);
  // Words that cross nothing yet get another go once more words are down.
  for (let progress = true; pending.length > 0 && progress; ) {
    progress = false;
    const left: Word[] = [];
    for (const word of pending) {
      const spot = board.best(word, side);
      if (spot) {
        board.put(word, spot.row, spot.col, spot.dir, spot.crossings);
        progress = true;
      } else {
        left.push(word);
      }
    }
    pending = left;
  }
  return board;
}

const ATTEMPTS = 24;

/**
 * Lays the words out as a crossword: every word crosses at least one other,
 * no two words touch side by side, and the grid stays within
 * CROSSWORD_LIMITS.side. Several orders are tried and the grid that fits the
 * most words, with the most crossings, in the smallest square-ish area wins.
 * Words that can't be fitted are listed in `unplaced`.
 */
export function layoutCrossword(entries: Pick<CrosswordEntry, "id" | "answer">[]): CrosswordLayout {
  const words: Word[] = entries
    .map((entry, index) => ({ id: entry.id, letters: answerLetters(entry.answer), index }))
    .filter((word) => word.letters.length >= CROSSWORD_LIMITS.lettersMin && word.letters.length <= CROSSWORD_LIMITS.letters);
  if (words.length === 0) return { width: 0, height: 0, placements: [], unplaced: entries.map((entry) => entry.id) };

  const random = seeded(Number.parseInt(fingerprint(words.map((word) => word.letters.join("")).join("|")), 36));
  const longestFirst = [...words].sort((a, b) => b.letters.length - a.letters.length || a.index - b.index);
  let best: Board | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // The first try is longest first; the others shuffle a little, still leaning long-first.
    const order =
      attempt === 0
        ? longestFirst
        : words
            .map((word) => ({ word, key: word.letters.length + random() * 6 }))
            .sort((a, b) => b.key - a.key)
            .map(({ word }) => word);
    const board = tryOrder(order, CROSSWORD_LIMITS.side);
    if (best === null || better(board, best)) best = board;
    if (best.placed.length === words.length && attempt >= 8) break;
  }
  return finish(best!, entries);
}

/**
 * The grid when some or all words were put in place by hand (in the editor,
 * or by an agent): those words stay exactly where they were put, as long as
 * they fit (letters agree where words cross, nothing touches side by side,
 * within CROSSWORD_LIMITS.side); a hand-placed word that doesn't fit is listed
 * in `clashes`. Words without a place are fitted around them (crossing a word
 * if they can, otherwise on a free spot). Without any hand-placed word this is
 * layoutCrossword. Hand-placed words may stand apart from the rest.
 */
export function arrangeCrossword(entries: ArrangedEntry[]): ArrangedLayout {
  if (!entries.some((entry) => entry.at)) return { ...layoutCrossword(entries), clashes: [] };
  const side = CROSSWORD_LIMITS.side;
  const words = entries
    .map((entry, index) => ({ id: entry.id, letters: answerLetters(entry.answer), index, at: entry.at }))
    .filter((word) => word.letters.length >= CROSSWORD_LIMITS.lettersMin && word.letters.length <= CROSSWORD_LIMITS.letters);
  const board = new Board();
  const clashes: string[] = [];
  for (const word of words) {
    if (!word.at) continue;
    const { row, col, dir } = word.at;
    const crossings = Number.isInteger(row) && Number.isInteger(col) ? board.fit(word.letters, row, col, dir, side) : -1;
    if (crossings < 0) clashes.push(word.id);
    else board.put(word, row, col, dir, crossings);
  }
  for (const word of words) {
    if (word.at) continue;
    const spot = board.placed.length === 0 ? { row: 0, col: 0, dir: "across" as const, crossings: 0 } : (board.best(word, side) ?? board.free(word, side));
    if (spot) board.put(word, spot.row, spot.col, spot.dir, "crossings" in spot ? spot.crossings : 0);
  }
  if (board.placed.length === 0) return { width: 0, height: 0, placements: [], unplaced: entries.map((entry) => entry.id), clashes };
  return { ...finish(board, entries), clashes };
}

/** Each placed word's square and direction, by id: what the editor and agents move. */
export function positionsOf(layout: CrosswordLayout): Map<string, CrosswordPosition> {
  return new Map(layout.placements.map((p) => [p.id, { row: p.row, col: p.col, dir: p.dir }]));
}

function area(board: Board) {
  return (board.maxR - board.minR + 1) * (board.maxC - board.minC + 1);
}

function better(a: Board, b: Board): boolean {
  if (a.placed.length !== b.placed.length) return a.placed.length > b.placed.length;
  if (a.crossings !== b.crossings) return a.crossings > b.crossings;
  return area(a) < area(b);
}

/** Moves the grid to start at row 0, column 0 and numbers the words the usual way: left to right, top to bottom. */
function finish(board: Board, entries: Pick<CrosswordEntry, "id">[]): CrosswordLayout {
  const shifted = board.placed.map((p) => ({ ...p, row: p.row - board.minR, col: p.col - board.minC }));
  const starts = [...new Set(shifted.map((p) => `${p.row},${p.col}`))]
    .map((key) => key.split(",").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([r, c], i) => [`${r},${c}`, i + 1]));
  const placedIds = new Set(shifted.map((p) => p.word.id));
  const order = new Map(entries.map((entry, i) => [entry.id, i]));
  return {
    width: board.maxC - board.minC + 1,
    height: board.maxR - board.minR + 1,
    placements: shifted
      .map((p) => ({ id: p.word.id, row: p.row, col: p.col, dir: p.dir, number: numbers.get(`${p.row},${p.col}`)! }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    unplaced: entries.map((entry) => entry.id).filter((id) => !placedIds.has(id)),
  };
}

// --- The grid, cell by cell ------------------------------------------------------------------

export type CrosswordCell = { row: number; col: number; number?: number };
export type CrosswordWord = {
  id: string;
  number: number;
  dir: CrosswordDirection;
  clue: string;
  enumeration: string;
  /** Indexes into `cells`, in reading order. */
  cells: number[];
};

/**
 * The cells that hold letters (top to bottom, left to right) and every placed
 * word with the cells it covers; `solution` holds each cell's letter. Students
 * get everything but the solution.
 */
export function crosswordGrid(entries: CrosswordEntry[], layout: CrosswordLayout) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const letterAt = new Map<string, string>();
  for (const p of layout.placements) {
    const entry = byId.get(p.id);
    if (!entry) continue;
    answerLetters(entry.answer).forEach((letter, k) => {
      letterAt.set(p.dir === "across" ? `${p.row},${p.col + k}` : `${p.row + k},${p.col}`, letter);
    });
  }
  const keys = [...letterAt.keys()]
    .map((key) => key.split(",").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const index = new Map(keys.map(([r, c], i) => [`${r},${c}`, i]));
  const numberAt = new Map(layout.placements.map((p) => [`${p.row},${p.col}`, p.number]));
  const cells: CrosswordCell[] = keys.map(([row, col]) => {
    const number = numberAt.get(`${row},${col}`);
    return number === undefined ? { row, col } : { row, col, number };
  });
  const words: CrosswordWord[] = layout.placements
    .filter((p) => byId.has(p.id))
    .map((p) => {
      const entry = byId.get(p.id)!;
      const length = answerLetters(entry.answer).length;
      return {
        id: p.id,
        number: p.number,
        dir: p.dir,
        clue: entry.clue,
        enumeration: enumeration(entry.answer),
        cells: Array.from({ length }, (_, k) => index.get(p.dir === "across" ? `${p.row},${p.col + k}` : `${p.row + k},${p.col}`)!),
      };
    })
    .sort((a, b) => (a.dir === b.dir ? a.number - b.number : a.dir === "across" ? -1 : 1));
  return { cells, words, solution: keys.map(([r, c]) => letterAt.get(`${r},${c}`)!) };
}

/** A fingerprint of the grid and its letters: students' saved progress belongs to one version of the puzzle. */
export function crosswordVersion(entries: CrosswordEntry[], layout: CrosswordLayout): string {
  const { cells, solution } = crosswordGrid(entries, layout);
  return fingerprint(`${layout.width}x${layout.height}|${cells.map((c) => `${c.row},${c.col}`).join(";")}|${solution.join("")}`);
}

// --- Tidying and rules -------------------------------------------------------------------------

/** An entry with its words trimmed and spaces collapsed: what gets stored and checked. */
export function tidyEntry<E extends CrosswordEntry>(entry: E): E {
  return { ...entry, answer: entry.answer.normalize("NFC").replace(/\s+/g, " ").trim(), clue: entry.clue.replace(/\s+/g, " ").trim() };
}

const ALLOWED = /^[\p{L}\p{M}\p{N}\s'’-]*$/u;

/**
 * What keeps a crossword from being accepted, every problem at once, each
 * with where it is ("entries[3].answer: …"). Includes words the grid
 * couldn't fit. Empty means it's fine.
 */
export function crosswordProblems(
  entries: (CrosswordEntry & { at?: CrosswordPosition })[],
  layout: CrosswordLayout & { clashes?: string[] } = arrangeCrossword(entries),
): string[] {
  const out: string[] = [];
  const L = CROSSWORD_LIMITS;
  if (entries.length < L.entriesMin || entries.length > L.entries) out.push(`entries: ${L.entriesMin} to ${L.entries} words.`);
  const seen = new Map<string, number>();
  const ids = new Set<string>();
  entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    if (entry.id !== "" && !CROSSWORD_ENTRY_ID.test(entry.id)) out.push(`${at}.id: letters, digits, - or _, up to 40.`);
    if (entry.id !== "" && ids.has(entry.id)) out.push(`${at}.id: "${entry.id}" is used twice.`);
    ids.add(entry.id);
    const letters = answerLetters(entry.answer);
    if (entry.answer.trim() === "") out.push(`${at}.answer: can't be empty.`);
    else if (!ALLOWED.test(entry.answer) || entry.answer.length > L.answer) {
      out.push(`${at}.answer: letters, digits, spaces and hyphens only, up to ${L.answer} characters.`);
    } else if (letters.length < L.lettersMin || letters.length > L.letters) {
      out.push(`${at}.answer: ${L.lettersMin} to ${L.letters} letters (it has ${letters.length}).`);
    } else {
      const key = letters.join("");
      const first = seen.get(key);
      if (first !== undefined) out.push(`${at}.answer: the same word as entries[${first}].`);
      else seen.set(key, i);
    }
    if (entry.clue.trim() === "") out.push(`${at}.clue: can't be empty.`);
    else if (entry.clue.length > L.clue) out.push(`${at}.clue: at most ${L.clue} characters.`);
  });
  if (out.length === 0) {
    entries.forEach((entry, i) => {
      if (layout.clashes?.includes(entry.id)) {
        out.push(
          `entries[${i}].answer: "${entry.answer}" can't go where it was put: it runs into another word, sits right beside one, or goes past the edge. Move it, or let Kalami lay out the grid again.`,
        );
      } else if (layout.unplaced.includes(entry.id)) {
        out.push(
          `entries[${i}].answer: "${entry.answer}" doesn't fit: it shares no letters with a free spot in the grid. Add words that share its letters, or leave it out.`,
        );
      }
    });
  }
  return out;
}
