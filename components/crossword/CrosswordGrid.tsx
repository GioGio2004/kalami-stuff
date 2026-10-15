"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { displayLetter, type CrosswordCell } from "@/lib/crossword";
import s from "./crossword.module.css";

/**
 * A crossword grid: only the squares that hold letters are drawn, numbered
 * where words start. It shows whatever letters it is given (the teacher's
 * preview passes the answers; the student's puzzle passes what they typed)
 * and marks the active square, the current word, wrong and revealed letters,
 * and a solved puzzle. With `onCell` the squares are buttons (the student's
 * board opens its fill-in popup from them); the editor's arrange mode listens
 * to pointer presses instead.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function CrosswordGrid({
  width,
  height,
  cells,
  letters,
  label,
  active = null,
  word = [],
  wrong,
  revealed,
  solved = false,
  maxCell = 56,
  fitHeight,
  onCell,
  cellLabel,
  onCellPointerDown,
  className = "",
}: {
  width: number;
  height: number;
  cells: CrosswordCell[];
  /** One per cell, "" for empty. */
  letters: string[];
  /** For screen readers: what the grid is. */
  label: string;
  active?: number | null;
  /** The cells of the word being filled in (or moved). */
  word?: number[];
  wrong?: ReadonlySet<number>;
  revealed?: ReadonlySet<number>;
  solved?: boolean;
  /** The largest a square gets, in pixels, so a small crossword doesn't fill a whole screen. */
  maxCell?: number;
  /** The most height the grid may take (a CSS length, e.g. "calc(100dvh - 12rem)"): full screen fits the grid to the screen. */
  fitHeight?: string;
  onCell?: (index: number) => void;
  cellLabel?: (index: number) => string;
  onCellPointerDown?: (index: number, event: ReactPointerEvent) => void;
  className?: string;
}) {
  const inWord = new Set(word);
  const maxWidth = fitHeight ? `min(${width * maxCell}px, calc(${fitHeight} * ${width} / ${height}))` : width * maxCell;
  return (
    <div className={`${s.frame} ${className}`} style={{ maxWidth }}>
      <div role="group" aria-label={label} className={s.grid} style={{ "--cols": width, "--rows": height } as CSSProperties}>
        {cells.map((cell, i) => {
          const classes = [
            s.cell,
            onCell || onCellPointerDown ? s.clickable : "",
            solved ? s.solved : i === active ? s.active : inWord.has(i) ? s.word : "",
            !solved && wrong?.has(i) ? s.wrong : "",
            !solved && revealed?.has(i) ? s.revealed : "",
          ];
          const style = { gridRow: cell.row + 1, gridColumn: cell.col + 1, "--delay": `${(cell.row + cell.col) * 35}ms` } as CSSProperties;
          const inside = (
            <>
              {cell.number !== undefined && <span className={s.number}>{cell.number}</span>}
              <span className={s.letter}>{letters[i] ? displayLetter(letters[i]) : ""}</span>
            </>
          );
          return onCell ? (
            <button
              key={`${cell.row},${cell.col}`}
              type="button"
              data-cell={i}
              aria-label={cellLabel?.(i)}
              className={`${classes.join(" ")} ${s.button}`}
              style={style}
              onClick={() => onCell(i)}
            >
              {inside}
            </button>
          ) : (
            <div
              key={`${cell.row},${cell.col}`}
              data-cell={i}
              className={classes.join(" ")}
              style={style}
              onPointerDown={onCellPointerDown ? (event) => onCellPointerDown(i, event) : undefined}
            >
              {inside}
            </div>
          );
        })}
      </div>
    </div>
  );
}
