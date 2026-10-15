"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import s from "@/components/crossword/crossword.module.css";
import { displayLetter, type CrosswordCell, type CrosswordDirection, type CrosswordPosition } from "@/lib/crossword";

/** A word on the arrange board: its key, letters and where it is. */
export type ArrangeWord = { key: string; number: number; letters: string[]; at: CrosswordPosition };

/** Free squares shown around the grid, so a word can be dragged out past its edge. */
const PAD = 2;

/**
 * The editor's "Move words" board: the grid with free squares around it.
 * Press a word to pick it (press a crossing square again for the other
 * word); drag it to move it, square by square, with a ghost showing where it
 * would land (red where it can't go); or use the arrow keys and T to turn
 * it. `canPlace` says whether a spot works; `onPlace` moves it there.
 */
export function ArrangeBoard({
  width,
  height,
  cells,
  letters,
  words,
  selected,
  onSelect,
  canPlace,
  onPlace,
  onTurn,
}: {
  width: number;
  height: number;
  cells: CrosswordCell[];
  letters: string[];
  words: ArrangeWord[];
  selected: string | null;
  onSelect: (key: string, pivot: number) => void;
  canPlace: (key: string, at: CrosswordPosition) => boolean;
  onPlace: (key: string, at: CrosswordPosition) => void;
  onTurn: () => void;
}) {
  const cols = width + PAD * 2;
  const rows = height + PAD * 2;
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; x: number; y: number; size: number; from: CrosswordPosition } | null>(null);
  const lastPress = useRef<{ row: number; col: number } | null>(null);
  const [ghost, setGhost] = useState<{ key: string; at: CrosswordPosition; ok: boolean } | null>(null);

  const cellsOf = (word: ArrangeWord, at = word.at) =>
    word.letters.map((letter, k) => ({ letter, row: at.dir === "down" ? at.row + k : at.row, col: at.dir === "across" ? at.col + k : at.col }));
  const wordsAt = (row: number, col: number) => words.filter((w) => cellsOf(w).some((c) => c.row === row && c.col === col));
  const chosen = words.find((w) => w.key === selected) ?? null;

  const press = (cell: CrosswordCell, event: ReactPointerEvent<HTMLDivElement>) => {
    const here = wordsAt(cell.row, cell.col);
    if (here.length === 0) return;
    const again = lastPress.current?.row === cell.row && lastPress.current?.col === cell.col;
    // A crossing square pressed again picks the other word through it.
    const word = again && chosen && here.length > 1 ? (here.find((w) => w.key !== chosen.key) ?? here[0]) : (here.find((w) => w.key === selected) ?? here[0]);
    lastPress.current = { row: cell.row, col: cell.col };
    const pivot = cellsOf(word).findIndex((c) => c.row === cell.row && c.col === cell.col);
    onSelect(word.key, pivot);
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { key: word.key, x: event.clientX, y: event.clientY, size: box.width / cols, from: word.at };
    grid.current?.setPointerCapture(event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dr = Math.round((event.clientY - d.y) / d.size);
    const dc = Math.round((event.clientX - d.x) / d.size);
    if (dr === 0 && dc === 0) {
      setGhost(null);
      return;
    }
    const at = { row: d.from.row + dr, col: d.from.col + dc, dir: d.from.dir };
    if (ghost && ghost.at.row === at.row && ghost.at.col === at.col) return;
    setGhost({ key: d.key, at, ok: canPlace(d.key, at) });
  };

  const release = () => {
    const g = ghost;
    drag.current = null;
    setGhost(null);
    if (g?.ok) onPlace(g.key, g.at);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!chosen) return;
    const steps: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const by = steps[event.key];
    if (by) {
      event.preventDefault();
      const at = { ...chosen.at, row: chosen.at.row + by[0], col: chosen.at.col + by[1] };
      if (canPlace(chosen.key, at)) onPlace(chosen.key, at);
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      onTurn();
    }
  };

  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) slots.push(<div key={`s${r},${c}`} className={s.slot} style={{ gridRow: r + 1, gridColumn: c + 1 }} />);
  }
  const lit = new Set(chosen ? cellsOf(chosen).map((c) => `${c.row},${c.col}`) : []);
  const ghostWord = ghost ? words.find((w) => w.key === ghost.key) : undefined;

  return (
    <div className={s.frame} style={{ maxWidth: cols * 44 }}>
      <div
        ref={grid}
        role="application"
        aria-label="Move words: press a word and drag it, or use the arrow keys; T turns it"
        tabIndex={0}
        className={`${s.grid} cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing`}
        style={{ "--cols": cols, "--rows": rows } as CSSProperties}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={() => {
          drag.current = null;
          setGhost(null);
        }}
        onKeyDown={onKeyDown}
      >
        {slots}
        {cells.map((cell, i) => (
          <div
            key={`c${cell.row},${cell.col}`}
            className={`${s.cell} ${s.clickable} ${lit.has(`${cell.row},${cell.col}`) ? s.active : ""}`}
            style={{ gridRow: cell.row + PAD + 1, gridColumn: cell.col + PAD + 1 }}
            onPointerDown={(event) => press(cell, event)}
          >
            {cell.number !== undefined && <span className={s.number}>{cell.number}</span>}
            <span className={s.letter}>{letters[i] ? displayLetter(letters[i]) : ""}</span>
          </div>
        ))}
        {ghost &&
          ghostWord &&
          cellsOf(ghostWord, ghost.at)
            // Squares past the board's edge aren't drawn (they'd stretch it); the grid grows when the word lands.
            .filter((c) => c.row + PAD >= 0 && c.col + PAD >= 0 && c.row + PAD < rows && c.col + PAD < cols)
            .map((c, k) => (
            <div
              key={`g${k}`}
              className={`${s.cell} ${s.ghost} ${ghost.ok ? "" : s.ghostBad}`}
              style={{ gridRow: c.row + PAD + 1, gridColumn: c.col + PAD + 1 }}
            >
              <span className={s.letter}>{displayLetter(c.letter)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

/** Where a word goes when it turns around one of its squares (the one pressed). */
export function turned(at: CrosswordPosition, pivot: number): CrosswordPosition {
  const dir: CrosswordDirection = at.dir === "across" ? "down" : "across";
  const row = at.dir === "down" ? at.row + pivot : at.row;
  const col = at.dir === "across" ? at.col + pivot : at.col;
  return dir === "down" ? { row: row - pivot, col, dir } : { row, col: col - pivot, dir };
}
