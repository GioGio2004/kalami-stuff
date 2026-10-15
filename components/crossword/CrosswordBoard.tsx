"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/buttons";
import { ArrowLeft, ArrowRight, Check, Cross } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";
import { answerLetters, displayLetter, type CrosswordCell, type CrosswordWord } from "@/lib/crossword";
import { CrosswordGrid } from "./CrosswordGrid";

/**
 * A crossword to solve: the grid, the clue being worked on, both clue lists
 * and the buttons. Tapping a square or a clue opens a small window with that
 * word's clue and one box per letter; what is typed there goes straight into
 * the grid (and is saved). Check, Reveal and "solved" are answered by the
 * caller: on the student app the server, which keeps the answers; in the
 * teacher's preview the editor, which has them. Full screen fills the screen
 * with the puzzle (for a projector, or to concentrate).
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */

export type BoardWord = Pick<CrosswordWord, "id" | "number" | "dir" | "clue" | "enumeration" | "cells">;
export type BoardProgress = { letters: string[]; revealed: number[]; solved: boolean };
export type BoardSaveResult = { solved: boolean; full: boolean; wrong?: number[] };

const SAVE_AFTER_MS = 700;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function CrosswordBoard({
  title,
  width,
  height,
  cells,
  words,
  initial,
  onSave,
  onReveal,
  onDownloadPdf,
  startFullScreen = false,
  onExitFullScreen,
  note,
}: {
  title: string;
  width: number;
  height: number;
  cells: CrosswordCell[];
  words: BoardWord[];
  initial: BoardProgress | null;
  onSave: (letters: string[], check: boolean) => Promise<BoardSaveResult>;
  onReveal: (cells: number[]) => Promise<{ cell: number; letter: string }[]>;
  /** Shows a Download PDF button. */
  onDownloadPdf?: () => Promise<void>;
  /** Opens full screen straight away (the teacher's preview); onExitFullScreen when it closes. */
  startFullScreen?: boolean;
  onExitFullScreen?: () => void;
  /** A line under the buttons, e.g. that a preview saves nothing. */
  note?: ReactNode;
}) {
  const total = cells.length;
  const [letters, setLetters] = useState<string[]>(() => (initial?.letters.length === total ? initial.letters : cells.map(() => "")));
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set(initial?.revealed ?? []));
  const [solved, setSolved] = useState(initial?.solved ?? false);
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState<BoardWord | undefined>(() => words[0]);
  /** The square last tapped: tapping it again turns to the word going the other way. */
  const [activeCell, setActiveCell] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "good" | "bad"; text: string } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reveal-all" | "clear" | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const wordDialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string[] | null>(null);

  const wordsAt = useCallback(
    (cell: number) => ({ across: words.find((w) => w.dir === "across" && w.cells.includes(cell)), down: words.find((w) => w.dir === "down" && w.cells.includes(cell)) }),
    [words],
  );
  const filled = letters.filter((letter) => letter !== "").length;

  // --- Saving ---

  const send = useCallback(
    async (next: string[], check: boolean) => {
      setSaving("saving");
      try {
        const result = await onSave(next, check);
        setSaving("saved");
        if (result.solved) {
          setSolved(true);
          setWrong(new Set());
          setMessage({ tone: "good", text: "Solved. Every letter is right." });
        } else if (check) {
          const bad = new Set(result.wrong ?? []);
          setWrong(bad);
          setMessage(
            bad.size === 0
              ? { tone: "good", text: result.full ? "All right so far." : "Everything you've written is right so far." }
              : { tone: "bad", text: `${bad.size} letter${bad.size === 1 ? " is" : "s are"} wrong: they're crossed out in red.` },
          );
        } else if (result.full) {
          setMessage({ tone: "info", text: "Every square is filled, but something isn't right yet. Check shows which letters." });
        }
        return result;
      } catch (caught) {
        setSaving("failed");
        setMessage({ tone: "bad", text: `Not saved: ${errorMessage(caught)}` });
        return null;
      }
    },
    [onSave],
  );

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) void send(next, false);
  }, [send]);

  const schedule = (next: string[]) => {
    pending.current = next;
    window.clearTimeout(timer.current);
    // A full grid is worth an answer straight away: solved, or not yet.
    if (next.every((letter) => letter !== "")) flush();
    else timer.current = window.setTimeout(flush, SAVE_AFTER_MS);
  };

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  /** Sets some cells' letters (revealed ones stay as they are). */
  const put = (changes: Map<number, string>) => {
    if (solved) return;
    const next = [...letters];
    let changed = false;
    for (const [cell, letter] of changes) {
      if (revealed.has(cell) || next[cell] === letter) continue;
      next[cell] = letter;
      changed = true;
    }
    if (!changed) return;
    setLetters(next);
    setWrong((set) => new Set([...set].filter((cell) => !changes.has(cell))));
    schedule(next);
  };

  // --- The fill-in window ---

  /** Opens the window for a word; focus goes to `at` (a position in the word) or its first empty box. */
  const openWord = (word: BoardWord, at?: number) => {
    // Synchronously, inside the tap: phones only show the keyboard for focus that happens there.
    flushSync(() => {
      setCurrent(word);
      setOpen(true);
    });
    const dialog = wordDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
    const start = at ?? Math.max(0, word.cells.findIndex((cell) => letters[cell] === "" && !revealed.has(cell)));
    boxes.current[start]?.focus();
    boxes.current[start]?.select();
  };

  const closeWord = () => {
    wordDialog.current?.close();
    setOpen(false);
    flush();
  };

  const tapCell = (cell: number) => {
    const { across, down } = wordsAt(cell);
    const sameWay = current?.dir === "down" ? down : across;
    const otherWay = current?.dir === "down" ? across : down;
    // The way the current word goes, unless this square was just tapped: then the other way.
    let word = sameWay ?? otherWay;
    if (cell === activeCell && sameWay && otherWay) word = current?.id === sameWay.id ? otherWay : sameWay;
    setActiveCell(cell);
    if (word) openWord(word, word.cells.indexOf(cell));
  };

  const step = (by: 1 | -1) => {
    if (!current) return;
    const index = words.indexOf(current);
    const next = words[(index + by + words.length) % words.length];
    if (open) openWord(next);
    else setCurrent(next);
  };

  const focusBox = (index: number) => {
    const box = boxes.current[index];
    if (box) {
      box.focus();
      box.select();
    }
  };

  const onBoxChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    if (!current) return;
    const typed = answerLetters(event.currentTarget.value);
    const cell = current.cells[index];
    if (typed.length === 0) {
      put(new Map([[cell, ""]]));
      return;
    }
    // A letter typed next to the one already in the box replaces it; several letters (a paste) spread over the boxes from here on.
    const old = letters[cell];
    const list = typed.length === 2 && old !== "" && typed.includes(old) ? [typed[0] === old ? typed[1] : typed[0]] : typed;
    const changes = new Map<number, string>();
    let at = index;
    for (const letter of list) {
      if (at >= current.cells.length) break;
      changes.set(current.cells[at], letter);
      at += 1;
    }
    put(changes);
    // On to the next box that isn't revealed.
    let next = Math.min(at, current.cells.length - 1);
    while (next < current.cells.length - 1 && revealed.has(current.cells[next])) next += 1;
    focusBox(next);
  };

  const onBoxKeyDown = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!current) return;
    if (event.key === "Backspace" && (letters[current.cells[index]] === "" || revealed.has(current.cells[index])) && index > 0) {
      event.preventDefault();
      put(new Map([[current.cells[index - 1], ""]]));
      focusBox(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight" && index < current.cells.length - 1) {
      event.preventDefault();
      focusBox(index + 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      closeWord();
    }
  };

  // --- Check, reveal, clear ---

  const check = async () => {
    flush();
    setBusy("check");
    await send(letters, true);
    setBusy(null);
  };

  const reveal = async (target: number[]) => {
    const wanted = target.filter((cell) => !revealed.has(cell));
    if (wanted.length === 0 || solved) return;
    window.clearTimeout(timer.current);
    pending.current = null;
    setBusy("reveal");
    try {
      // The letters typed so far go first, so only what's empty or wrong counts as revealed.
      await onSave(letters, false);
      const shown = await onReveal(wanted);
      const next = [...letters];
      for (const { cell, letter } of shown) next[cell] = letter;
      setLetters(next);
      setRevealed((set) => new Set([...set, ...shown.map((r) => r.cell)]));
      setWrong((set) => new Set([...set].filter((cell) => !wanted.includes(cell))));
      if (next.every((letter) => letter !== "")) await send(next, false);
      else setMessage(null);
    } catch (caught) {
      setMessage({ tone: "bad", text: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  };

  const clear = (target: number[]) => {
    put(new Map(target.map((cell) => [cell, ""])));
    setMessage(null);
  };

  const ask = (what: "reveal-all" | "clear") => {
    flushSync(() => setConfirm(what));
    confirmDialog.current?.showModal();
  };

  const answer = (yes: boolean) => {
    const what = confirm;
    confirmDialog.current?.close();
    setConfirm(null);
    if (!yes) return;
    if (what === "clear") clear(cells.map((_, i) => i));
    else void reveal(cells.map((_, i) => i));
  };

  // --- Full screen ---

  const enter = useCallback(() => {
    setFullScreen(true);
    const el = root.current;
    if (el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => undefined);
  }, []);

  const leave = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setFullScreen(false);
    onExitFullScreen?.();
  };

  // The browser's own Esc (or its exit button) ends full screen too.
  useEffect(() => {
    if (!fullScreen) return;
    const onChange = () => {
      if (document.fullscreenElement === null && root.current && !root.current.matches(":fullscreen")) {
        setFullScreen(false);
        onExitFullScreen?.();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.documentElement.style.overflow = overflow;
    };
  }, [fullScreen, onExitFullScreen]);

  const started = useRef(false);
  useEffect(() => {
    if (startFullScreen && !started.current) {
      started.current = true;
      enter();
    }
  }, [startFullScreen, enter]);

  // --- Drawing ---

  const label = (cell: number) => {
    const { across, down } = wordsAt(cell);
    const parts = [across && `${across.number} across`, down && `${down.number} down`].filter(Boolean).join(" and ");
    return `${parts}${letters[cell] ? `, ${displayLetter(letters[cell])}` : ", empty"}`;
  };
  // The word through the tapped square going the other way (or the first one crossing this word).
  const otherDir = current?.dir === "across" ? "down" : "across";
  const crossing = current
    ? ((activeCell !== null && current.cells.includes(activeCell) ? wordsAt(activeCell)[otherDir] : undefined) ??
      current.cells.map((cell) => wordsAt(cell)[otherDir]).find((w) => w !== undefined))
    : undefined;

  const iconButton = `grid w-10 shrink-0 place-items-center rounded-2xl bg-card text-graphite ring-1 ring-line transition hover:text-ink ${focusRing}`;

  return (
    <section
      ref={root}
      aria-label={`${title}: crossword`}
      className={fullScreen ? "fixed inset-0 z-[60] overflow-y-auto bg-paper px-3 py-4 sm:px-8 sm:py-6" : ""}
    >
      {fullScreen && (
        <div className="mx-auto mb-4 flex max-w-[110rem] items-center justify-between gap-4">
          <p className="min-w-0 truncate text-lg font-medium tracking-tight sm:text-2xl">{title}</p>
          <Button size="sm" variant="outline" className="bg-card" onClick={leave}>
            <Cross className="size-4" />
            Exit full screen
          </Button>
        </div>
      )}
      <div className={`grid gap-6 lg:grid-cols-12 lg:items-start ${fullScreen ? "mx-auto max-w-[110rem]" : ""}`}>
        <div className="rounded-[2rem] bg-panel p-3 sm:p-6 lg:col-span-7">
          <div aria-live="polite" className="flex items-stretch gap-2">
            <button type="button" aria-label="Previous word" onClick={() => step(-1)} className={iconButton}>
              <ArrowLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => current && openWord(current)}
              disabled={solved || !current}
              className={`min-h-14 min-w-0 flex-1 rounded-2xl bg-ink px-4 py-2.5 text-left text-paper ${focusRing}`}
            >
              {solved ? (
                <span className="font-medium text-highlighter">Solved</span>
              ) : current ? (
                <>
                  <span className="mr-2 font-semibold text-highlighter tabular-nums">
                    {current.number} {current.dir}
                  </span>
                  <span className="leading-snug">
                    {current.clue} <span className="whitespace-nowrap text-paper/60">{current.enumeration}</span>
                  </span>
                </>
              ) : null}
            </button>
            <button type="button" aria-label="Next word" onClick={() => step(1)} className={iconButton}>
              <ArrowRight className="size-4" />
            </button>
          </div>

          <CrosswordGrid
            className="mt-4 sm:mt-5"
            width={width}
            height={height}
            cells={cells}
            letters={letters}
            label={`${title}: tap a square to fill in its word`}
            word={solved ? [] : (current?.cells ?? [])}
            wrong={wrong}
            revealed={revealed}
            solved={solved}
            maxCell={fullScreen ? 96 : 56}
            fitHeight={fullScreen ? "calc(100dvh - 15rem)" : undefined}
            onCell={tapCell}
            cellLabel={label}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
            <Button size="sm" disabled={busy !== null || solved || filled === 0} onClick={check}>
              <Check className="size-4" />
              Check
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || solved} onClick={() => ask("reveal-all")}>
              Reveal all…
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || solved || filled === 0} onClick={() => ask("clear")}>
              Clear…
            </Button>
            {!fullScreen && (
              <Button size="sm" variant="outline" className="bg-card" onClick={enter}>
                <ExpandIcon />
                Full screen
              </Button>
            )}
            {onDownloadPdf && (
              <Button
                size="sm"
                variant="outline"
                className="bg-card"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("pdf");
                  try {
                    await onDownloadPdf();
                  } catch (caught) {
                    setMessage({ tone: "bad", text: errorMessage(caught) });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <DownloadIcon />
                {busy === "pdf" ? "Making the PDF…" : "PDF"}
              </Button>
            )}
            <span className="ml-auto text-xs text-graphite" aria-live="polite">
              {filled}/{total}
              {saving === "saving" ? " · saving…" : saving === "saved" ? " · saved" : saving === "failed" ? " · not saved" : ""}
            </span>
          </div>
          {note && <p className="mt-2 text-xs text-graphite">{note}</p>}

          {message && (
            <p
              role="status"
              className={`mt-3 rounded-2xl px-4 py-3 text-sm ${
                message.tone === "good" ? "bg-ok/12 text-ink" : message.tone === "bad" ? "bg-red-pen/10 text-red-pen" : "bg-card text-ink ring-1 ring-line"
              }`}
            >
              {message.text}
            </p>
          )}

          {solved && (
            <div className="mt-4 rounded-2xl bg-ink px-5 py-5 text-paper">
              <p className="-rotate-2 font-hand text-[1.7rem] leading-none text-highlighter">Nicely done</p>
              <p className="mt-2 text-[15px] text-paper/80">
                You solved “{title}”
                {revealed.size > 0 ? ` with ${revealed.size} letter${revealed.size === 1 ? "" : "s"} revealed` : " without revealing a letter"}.
              </p>
            </div>
          )}
        </div>

        <aside
          aria-label="Clues"
          className="grid gap-6 rounded-[2rem] bg-card p-5 ring-1 ring-line sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1 xl:grid-cols-2"
        >
          {(["across", "down"] as const).map((dir) => (
            <div key={dir}>
              <h2 className="text-lg font-medium capitalize tracking-tight">{dir}</h2>
              <ol className="mt-2 space-y-1">
                {words
                  .filter((word) => word.dir === dir)
                  .map((word) => {
                    const on = current?.id === word.id && !solved;
                    const done = word.cells.every((cell) => letters[cell] !== "");
                    return (
                      <li key={word.id}>
                        <button
                          type="button"
                          disabled={solved}
                          onClick={() => openWord(word)}
                          className={`flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left text-[15px] leading-snug transition ${focusRing} ${
                            on ? "bg-highlighter" : "hover:bg-panel"
                          } ${done && !on ? "text-graphite" : ""}`}
                        >
                          <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{word.number}</span>
                          <span className="min-w-0">
                            {word.clue} <span className="whitespace-nowrap text-graphite">{word.enumeration}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ol>
            </div>
          ))}
        </aside>
      </div>

      {/* The fill-in window: one box per letter; what's typed goes straight into the grid. */}
      <dialog
        ref={wordDialog}
        aria-label={current ? `${current.number} ${current.dir}` : "Fill in a word"}
        onClose={() => {
          setOpen(false);
          flush();
        }}
        onClick={(event) => {
          if (event.target === wordDialog.current) closeWord();
        }}
        className="m-auto w-[calc(100%-1.5rem)] max-w-xl rounded-[2rem] bg-card p-0 text-ink shadow-2xl backdrop:bg-ink/45 max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
      >
        {open && current && (
          <div className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-graphite tabular-nums">
                  {current.number} {current.dir} · {current.cells.length} letters
                </p>
                <p className="mt-1 text-xl font-medium leading-snug tracking-tight">
                  {current.clue} <span className="whitespace-nowrap text-graphite">{current.enumeration}</span>
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closeWord} className={`grid size-10 shrink-0 place-items-center rounded-full hover:bg-panel ${focusRing}`}>
                <Cross className="size-5" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Letters">
              {current.cells.map((cell, index) => {
                const bad = wrong.has(cell);
                const locked = revealed.has(cell) || solved;
                return (
                  <input
                    key={cell}
                    ref={(el) => {
                      boxes.current[index] = el;
                    }}
                    aria-label={`Letter ${index + 1} of ${current.cells.length}`}
                    value={letters[cell] ? displayLetter(letters[cell]) : ""}
                    readOnly={locked}
                    onChange={(event) => onBoxChange(index, event)}
                    onKeyDown={(event) => onBoxKeyDown(index, event)}
                    onFocus={(event) => event.currentTarget.select()}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    inputMode="text"
                    enterKeyHint={index === current.cells.length - 1 ? "done" : "next"}
                    className={`size-11 rounded-xl text-center text-xl font-semibold outline-none ring-2 transition sm:size-12 ${
                      locked ? "bg-ok/12 text-graphite ring-ok/50" : bad ? "bg-red-pen/10 text-red-pen ring-red-pen" : "bg-paper ring-ink/70 focus:bg-highlighter focus:ring-ink"
                    }`}
                  />
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null || solved} onClick={() => void check()}>
                <Check className="size-4" />
                Check
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null || solved} onClick={() => void reveal(current.cells)}>
                Reveal word
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null || solved} onClick={() => clear(current.cells)}>
                Clear word
              </Button>
              {crossing && (
                <Button size="sm" variant="ghost" onClick={() => openWord(crossing, activeCell !== null ? Math.max(0, crossing.cells.indexOf(activeCell)) : undefined)}>
                  Switch to {crossing.number} {crossing.dir}
                </Button>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
              <div className="flex gap-1">
                <button type="button" aria-label="Previous word" onClick={() => step(-1)} className={`${iconButton} h-10`}>
                  <ArrowLeft className="size-4" />
                </button>
                <button type="button" aria-label="Next word" onClick={() => step(1)} className={`${iconButton} h-10`}>
                  <ArrowRight className="size-4" />
                </button>
              </div>
              <Button onClick={closeWord}>Done</Button>
            </div>
          </div>
        )}
      </dialog>

      <dialog
        ref={confirmDialog}
        aria-label={confirm === "clear" ? "Clear the grid" : "Reveal the whole crossword"}
        onClose={() => setConfirm(null)}
        className="m-auto w-[calc(100%-1.5rem)] max-w-lg rounded-[2rem] bg-card p-0 text-ink shadow-2xl backdrop:bg-ink/45"
      >
        {confirm && (
          <div className="p-6 sm:p-8">
            <h2 className="text-2xl font-medium tracking-[-0.03em]">{confirm === "clear" ? "Clear your letters?" : "Reveal every answer?"}</h2>
            <p className="mt-3 text-[15px] text-graphite">
              {confirm === "clear"
                ? "Every letter you wrote goes; revealed letters stay. You can start again from scratch."
                : "Every empty or wrong square fills in with the right letter. Those count as revealed, so it's best saved for when you're really stuck."}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => answer(false)}>
                Not now
              </Button>
              <Button variant={confirm === "clear" ? "danger" : "ink"} onClick={() => answer(true)}>
                {confirm === "clear" ? "Clear" : "Reveal all"}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.5v9M6 9l4 4 4-4M4 15.5h12" />
    </svg>
  );
}
