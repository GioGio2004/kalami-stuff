"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { CrosswordBoard } from "@/components/crossword/CrosswordBoard";
import { CrosswordGrid } from "@/components/crossword/CrosswordGrid";
import { downloadCrosswordPdf } from "@/components/crossword/pdf";
import { SaveBar, TitleEditor } from "@/components/lessons-editor/LessonEditor";
import type { CrosswordDetail } from "@/components/studio/types";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { FormError, Segmented, TextArea, TextInput } from "@/components/ui/form";
import { ArrowLeft, Check, Plus, Robot, Trash } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import {
  answerLetters,
  arrangeCrossword,
  CROSSWORD_LIMITS,
  crosswordGrid,
  crosswordProblems,
  enumeration,
  positionsOf,
  type CrosswordEntry,
  type CrosswordLayout,
  type CrosswordPosition,
} from "@/lib/crossword";
import { ArrangeBoard, turned } from "./ArrangeBoard";
import { parseWordList } from "./wordList";

/** A word being edited: `key` is the editor's own (the saved id, for saved words); `at`, where it was put by hand. */
type Row = { key: string; id?: string; answer: string; clue: string; at?: CrosswordPosition };

let counter = 0;
/** Only ever called in the browser (adding a word), so server and browser render the same keys. */
const newKey = () => `new-${++counter}`;
const fromServer = (entries: CrosswordEntry[], layout: CrosswordLayout, arranged: boolean): Row[] => {
  const at = arranged ? positionsOf(layout) : new Map<string, CrosswordPosition>();
  return entries.map((entry) => ({ key: entry.id, id: entry.id, answer: entry.answer, clue: entry.clue, at: at.get(entry.id) }));
};
const contentKey = (rows: Row[], arranged: boolean) =>
  JSON.stringify([arranged, rows.map((row) => [row.answer.trim(), row.clue.trim(), arranged ? row.at : null])]);

/**
 * The crossword editor: a list of words with clues, and the grid Kalami lays
 * out from them, live, beside it (answers shown, or hidden to see what
 * students get). "Move words" lets the teacher drag words to other squares
 * or turn them; "Lay out again" hands the grid back to Kalami. Preview shows
 * the puzzle full screen exactly as students solve it; PDF prints it with an
 * answer key. Everything is saved at once (Save, or Ctrl/Cmd+S); a word that
 * can't go where it is is marked.
 */
export function CrosswordEditor({
  crossword,
  onRename,
  onSave,
  onSetStatus,
  onDelete,
}: {
  crossword: CrosswordDetail;
  onRename: (title: string) => Promise<void>;
  /** Saves every word (with its place, when they were put by hand); returns the ids they ended up with, in order. */
  onSave: (entries: { id?: string; answer: string; clue: string; at?: CrosswordPosition }[]) => Promise<string[]>;
  onSetStatus: (status: "draft" | "published") => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const canEdit = crossword.canEdit;
  const [rows, setRows] = useState<Row[]>(() => fromServer(crossword.entries, crossword.layout, crossword.arranged));
  const [arranged, setArranged] = useState(crossword.arranged);
  const [saved, setSaved] = useState(() => contentKey(fromServer(crossword.entries, crossword.layout, crossword.arranged), crossword.arranged));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [view, setView] = useState<"answers" | "students" | "arrange">("answers");
  const [selected, setSelected] = useState<{ key: string; pivot: number } | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const dirty = contentKey(rows, arranged) !== saved;

  // The grid, live: the same layout the server will make from these words (and places).
  const entries = useMemo(
    () => rows.map((row) => ({ id: row.key, answer: row.answer, clue: row.clue, at: arranged ? row.at : undefined })),
    [rows, arranged],
  );
  const layout = useMemo(() => arrangeCrossword(entries), [entries]);
  const grid = useMemo(() => crosswordGrid(entries, layout), [entries, layout]);
  const problems = useMemo(() => crosswordProblems(entries, layout), [entries, layout]);
  const rowProblems = new Map<number, string[]>();
  const listProblems: string[] = [];
  for (const problem of problems) {
    const match = /^entries\[(\d+)\]\.(\w+): (.*)$/.exec(problem);
    if (match) {
      const text = `${match[2] === "clue" ? "Clue" : "Word"}: ${match[3]}`;
      rowProblems.set(Number(match[1]), [...(rowProblems.get(Number(match[1])) ?? []), text]);
    }
    else listProblems.push(problem.replace(/^entries: /, "Words: "));
  }
  const placement = new Map(layout.placements.map((p) => [p.id, p]));

  // Changes from somewhere else (an agent, another tab): taken in when nothing here is unsaved.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(crossword.updatedAt);
  const [ownPending, setOwnPending] = useState(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  if (crossword.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(crossword.updatedAt);
    if (ownPending > 0) {
      setOwnPending(ownPending - 1);
    } else if (!dirty) {
      const next = fromServer(crossword.entries, crossword.layout, crossword.arranged);
      setRows(next);
      setArranged(crossword.arranged);
      setSaved(contentKey(next, crossword.arranged));
      setRemoteChanged(false);
    } else {
      setRemoteChanged(true);
    }
  }

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  async function save(): Promise<boolean> {
    if (!canEdit || saveState === "saving") return false;
    if (problems.length > 0) {
      setSaveError(`Fix the ${problems.length === 1 ? "problem" : `${problems.length} problems`} marked below first.`);
      return false;
    }
    // Words put by hand are sent where they show now (words added since are fitted in, as on screen).
    const at = positionsOf(layout);
    const sent = arranged ? rows.map((row) => ({ ...row, at: at.get(row.key) ?? row.at })) : rows;
    const sentArranged = arranged;
    setSaveState("saving");
    setSaveError(null);
    setOwnPending((n) => n + 1);
    try {
      const ids = await onSave(sent.map((row) => ({ id: row.id, answer: row.answer, clue: row.clue, at: sentArranged ? row.at : undefined })));
      const idByKey = new Map(sent.map((row, i) => [row.key, ids[i]]));
      setRows((current) =>
        current.map((row) => {
          const placed = sent.find((s) => s.key === row.key);
          return idByKey.has(row.key) ? { ...row, id: idByKey.get(row.key), at: placed?.at ?? row.at } : row;
        }),
      );
      setSaved(contentKey(sent, sentArranged));
      setSaveState("saved");
      return true;
    } catch (caught) {
      setOwnPending((n) => Math.max(0, n - 1));
      setSaveError(errorMessage(caught));
      setSaveState("idle");
      return false;
    }
  }

  async function own(action: () => Promise<void>): Promise<boolean> {
    setActionError(null);
    setOwnPending((n) => n + 1);
    try {
      await action();
      return true;
    } catch (caught) {
      setOwnPending((n) => Math.max(0, n - 1));
      setActionError(errorMessage(caught));
      return false;
    }
  }

  async function setStatus(status: "draft" | "published") {
    setStatusBusy(true);
    if (status === "published" && dirty && !(await save())) {
      setStatusBusy(false);
      return;
    }
    await own(() => onSetStatus(status));
    setStatusBusy(false);
  }

  // Ctrl/Cmd+S saves.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty) void save();
    }
  });
  useEffect(() => {
    if (!canEdit) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [canEdit]);

  // Unsaved changes: warn before the tab closes, and before an in-app link leaves the page.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("This crossword has unsaved changes. Leave without saving them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    if (saveError) setSaveError(null);
  }

  function add(words: { answer: string; clue: string }[], replace = false) {
    const added = words.map((word) => ({ key: newKey(), ...word }));
    setRows((current) => [...(replace ? [] : current), ...added].slice(0, CROSSWORD_LIMITS.entries));
    if (added.length === 1) {
      requestAnimationFrame(() => document.getElementById(`answer-${added[0].key}`)?.focus());
    }
  }

  // --- Moving words by hand ---

  /** Every word where it shows now, and this one where it would go: does it fit there? */
  const tryPlace = (key: string, at: CrosswordPosition) => {
    const now = positionsOf(layout);
    const result = arrangeCrossword(rows.map((row) => ({ id: row.key, answer: row.answer, at: row.key === key ? at : (now.get(row.key) ?? (arranged ? row.at : undefined)) })));
    return result.clashes.length === 0 && result.placements.some((p) => p.id === key) ? result : null;
  };

  const place = (key: string, at: CrosswordPosition) => {
    const result = tryPlace(key, at);
    if (!result) {
      setMoveNote("It can't go there: its letters would run into another word or sit right beside one.");
      return;
    }
    const placedAt = positionsOf(result);
    setRows((current) => current.map((row) => ({ ...row, at: placedAt.get(row.key) })));
    setArranged(true);
    setMoveNote(null);
    if (saveError) setSaveError(null);
  };

  const chosen = selected ? layout.placements.find((p) => p.id === selected.key) : undefined;
  const nudge = (dr: number, dc: number) => chosen && place(chosen.id, { row: chosen.row + dr, col: chosen.col + dc, dir: chosen.dir });
  const turn = () => chosen && selected && place(chosen.id, turned({ row: chosen.row, col: chosen.col, dir: chosen.dir }, selected.pivot));

  const layOutAgain = () => {
    setRows((current) => current.map((row) => ({ ...row, at: undefined })));
    setArranged(false);
    setSelected(null);
    setMoveNote(null);
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setActionError(null);
    try {
      await downloadCrosswordPdf({
        title: crossword.title,
        subtitle: `${crossword.courseTitle} · ${crossword.weekTitle}`,
        width: layout.width,
        height: layout.height,
        cells: grid.cells,
        words: grid.words,
        solution: grid.solution,
        answers: Object.fromEntries(rows.map((row) => [row.key, row.answer])),
      });
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPdfBusy(false);
    }
  };

  const placed = layout.placements.length;
  const published = crossword.status === "published";

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
        <Link href={`/courses/${crossword.courseId}`} className="inline-flex items-center gap-2 rounded-full hover:text-ink">
          <ArrowLeft className="size-4" />
          {crossword.courseTitle}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/courses/${crossword.courseId}#week-${crossword.weekId}`} className="rounded-full hover:text-ink">
          {crossword.weekTitle}
        </Link>
      </nav>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="ink">Crossword</Pill>
            <Pill tone={statusTone(crossword.status)}>{statusLabel(crossword.status)}</Pill>
            {crossword.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Drafted by an agent
              </Pill>
            )}
            {!canEdit && <Pill>View only</Pill>}
          </div>
          <TitleEditor title={crossword.title} canEdit={canEdit} label="Crossword title" onRename={(title) => own(() => onRename(title))} />
          <p className="mt-3 text-[15px] text-graphite">
            {rows.length} word{rows.length === 1 ? "" : "s"} · {layout.width} × {layout.height} grid · practice, not graded
            {dirty && " · unsaved changes"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" disabled={grid.cells.length === 0} onClick={() => setPreviewing(true)}>
            <ExpandIcon />
            Preview
          </Button>
          <Button
            variant="outline"
            disabled={grid.cells.length === 0 || pdfBusy}
            title={dirty ? "The PDF has what's on screen, unsaved changes included" : "The puzzle to print, and an answer key"}
            onClick={() => void downloadPdf()}
          >
            <DownloadIcon />
            {pdfBusy ? "Making the PDF…" : "PDF"}
          </Button>
          {crossword.canManage &&
            (crossword.status === "draft" ? (
              <Button variant="lime" disabled={statusBusy} onClick={() => setStatus("published")}>
                <Check className="size-4" />
                {dirty ? "Save and publish" : "Publish"}
              </Button>
            ) : (
              <Button variant="outline" disabled={statusBusy} onClick={() => setStatus("draft")}>
                Move back to draft
              </Button>
            ))}
          {crossword.canManage && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          )}
        </div>
      </div>

      <Visibility crossword={crossword} />

      <div aria-live="polite">
        {actionError && (
          <div className="mt-4">
            <FormError>{actionError}</FormError>
          </div>
        )}
        {saveError && (
          <div className="mt-4">
            <FormError>Not saved. {saveError}</FormError>
          </div>
        )}
        {listProblems.length > 0 && (
          <div className="mt-4">
            <FormError>{listProblems.join(" ")}</FormError>
          </div>
        )}
        {remoteChanged && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-64">
              This crossword was changed somewhere else (your agent, or another tab) while you were editing. Saving keeps your version.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = fromServer(crossword.entries, crossword.layout, crossword.arranged);
                setRows(next);
                setArranged(crossword.arranged);
                setSaved(contentKey(next, crossword.arranged));
                setRemoteChanged(false);
              }}
            >
              Load theirs instead
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-start">
        <section aria-label="Words and clues" className="lg:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h2 className="text-xl font-medium tracking-tight">Words and clues</h2>
              <p className="mt-0.5 text-sm text-graphite">
                One word or short phrase each, with a one-line clue that doesn&apos;t give it away. 8 to 15 words that share letters make the best grids.
              </p>
            </div>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
                Paste a list
              </Button>
            )}
          </div>

          <ol className="mt-4 space-y-2.5">
            {rows.map((row, i) => {
              const where = placement.get(row.key);
              const issues = rowProblems.get(i) ?? [];
              const letters = answerLetters(row.answer).length;
              return (
                <li
                  key={row.key}
                  className={`rounded-2xl bg-card p-3 ring-1 transition sm:p-4 ${issues.length > 0 ? "ring-red-pen/50" : "ring-line"}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1.5 grid h-9 min-w-12 shrink-0 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums ${
                        where ? "bg-ink text-highlighter" : "bg-panel text-graphite"
                      }`}
                      title={where ? `${where.number} ${where.dir}` : "Not in the grid yet"}
                    >
                      {where ? `${where.number}${where.dir === "across" ? "→" : "↓"}` : "—"}
                    </span>
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
                      <label className="min-w-0">
                        <span className="sr-only">Word {i + 1}</span>
                        <TextInput
                          id={`answer-${row.key}`}
                          value={row.answer}
                          readOnly={!canEdit}
                          maxLength={CROSSWORD_LIMITS.answer}
                          placeholder="Word"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => update(row.key, { answer: e.target.value })}
                          className="font-medium"
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="sr-only">Clue for word {i + 1}</span>
                        <TextInput
                          value={row.clue}
                          readOnly={!canEdit}
                          maxLength={CROSSWORD_LIMITS.clue}
                          placeholder="Clue"
                          onChange={(e) => update(row.key, { clue: e.target.value })}
                        />
                      </label>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove word ${i + 1}`}
                        onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                        className="mt-1.5 grid size-9 shrink-0 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-red-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <Trash className="size-4" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 pl-15 text-xs text-graphite">
                    {letters > 0 ? `${letters} letters ${enumeration(row.answer)}` : "No letters yet"}
                  </p>
                  {issues.map((issue, n) => (
                    <p key={n} className="mt-1 pl-15 text-xs text-red-pen">
                      {issue}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
          {canEdit && rows.length < CROSSWORD_LIMITS.entries && (
            <Button variant="outline" className="mt-3 bg-card" onClick={() => add([{ answer: "", clue: "" }])}>
              <Plus className="size-4" />
              Add a word
            </Button>
          )}
          {canEdit && <SaveBar dirty={dirty} state={saveState} failed={saveError !== null} floating onSave={() => void save()} />}
        </section>

        <aside aria-label="The grid" className="lg:sticky lg:top-24 lg:col-span-5">
          <div className="rounded-[2rem] bg-paper p-5 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-hand text-[1.35rem] leading-none text-graphite">The grid</p>
              <Segmented
                label="What the grid shows"
                value={view}
                options={[
                  { value: "answers", label: "Answers" },
                  { value: "students", label: "Empty" },
                  ...(canEdit ? [{ value: "arrange" as const, label: "Move words" }] : []),
                ]}
                onChange={(next) => {
                  setView(next);
                  setMoveNote(null);
                }}
              />
            </div>
            <p className="mt-1 text-xs text-graphite">
              {arranged ? "Words placed by hand" : "Kalami lays it out from the words"}: {placed} of {rows.length} placed
              {crossword.students.started > 0 &&
                ` · ${crossword.students.started} student${crossword.students.started === 1 ? "" : "s"} started, ${crossword.students.solved} solved`}
              .
            </p>
            {grid.cells.length > 0 && view === "arrange" ? (
              <div className="mt-4">
                <p className="text-xs leading-relaxed text-graphite">
                  Press a word and drag it to another square, or pick it and use the arrows; Turn swaps across and down around
                  the square you pressed. Letters must agree where words cross.
                </p>
                <ArrangeBoard
                  width={layout.width}
                  height={layout.height}
                  cells={grid.cells}
                  letters={grid.solution}
                  words={layout.placements.map((p) => ({
                    key: p.id,
                    number: p.number,
                    letters: answerLetters(rows.find((row) => row.key === p.id)?.answer ?? ""),
                    at: { row: p.row, col: p.col, dir: p.dir },
                  }))}
                  selected={selected?.key ?? null}
                  onSelect={(key, pivot) => {
                    setSelected({ key, pivot });
                    setMoveNote(null);
                  }}
                  canPlace={(key, at) => tryPlace(key, at) !== null}
                  onPlace={place}
                  onTurn={turn}
                />
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {chosen ? (
                    <>
                      <span className="mr-1 text-sm font-medium">
                        {chosen.number} {chosen.dir}: {rows.find((row) => row.key === chosen.id)?.answer}
                      </span>
                      <MoveButton label="Up" onClick={() => nudge(-1, 0)}>↑</MoveButton>
                      <MoveButton label="Down" onClick={() => nudge(1, 0)}>↓</MoveButton>
                      <MoveButton label="Left" onClick={() => nudge(0, -1)}>←</MoveButton>
                      <MoveButton label="Right" onClick={() => nudge(0, 1)}>→</MoveButton>
                      <Button size="sm" variant="outline" className="bg-card" onClick={turn}>
                        Turn
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-graphite">Press a word in the grid to pick it.</span>
                  )}
                  {arranged && (
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={layOutAgain}>
                      Lay out again
                    </Button>
                  )}
                </div>
                {moveNote && <p className="mt-2 text-xs text-red-pen">{moveNote}</p>}
              </div>
            ) : grid.cells.length > 0 ? (
              <CrosswordGrid
                className="mt-5"
                width={layout.width}
                height={layout.height}
                cells={grid.cells}
                letters={view === "answers" ? grid.solution : grid.cells.map(() => "")}
                label={`Crossword grid, ${layout.width} by ${layout.height}`}
                maxCell={44}
              />
            ) : (
              <p className="mt-5 rounded-2xl bg-panel px-4 py-8 text-center text-sm text-graphite">Add words to see the grid.</p>
            )}
            {grid.words.length > 0 && (
              <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {(["across", "down"] as const).map((dir) => (
                  <div key={dir}>
                    <p className="font-medium capitalize">{dir}</p>
                    <ol className="mt-1.5 space-y-1">
                      {grid.words
                        .filter((word) => word.dir === dir)
                        .map((word) => (
                          <li key={word.id} className="flex gap-2 leading-snug">
                            <span className="w-5 shrink-0 text-right font-semibold tabular-nums">{word.number}</span>
                            <span className="min-w-0 text-graphite">
                              {word.clue || "…"} <span className="whitespace-nowrap">{word.enumeration}</span>
                            </span>
                          </li>
                        ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {previewing && (
        <CrosswordBoard
          title={crossword.title}
          width={layout.width}
          height={layout.height}
          cells={grid.cells}
          words={grid.words}
          initial={null}
          startFullScreen
          onExitFullScreen={() => setPreviewing(false)}
          note="Preview: this is what students get. Letters you type here aren't saved."
          onSave={async (letters, check) => {
            const full = letters.every((letter) => letter !== "");
            return {
              solved: full && letters.every((letter, i) => letter === grid.solution[i]),
              full,
              wrong: check ? letters.flatMap((letter, i) => (letter !== "" && letter !== grid.solution[i] ? [i] : [])) : undefined,
            };
          }}
          onReveal={async (cells) => cells.map((cell) => ({ cell, letter: grid.solution[cell] }))}
        />
      )}

      <Dialog open={pasting} onClose={() => setPasting(false)} label="Paste a list of words">
        {pasting && (
          <PasteWords
            onAdd={(words, replace) => {
              add(words, replace);
              setPasting(false);
            }}
            onCancel={() => setPasting(false)}
          />
        )}
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete crossword">
        {confirmDelete && (
          <DeleteCrossword
            title={crossword.title}
            published={published && crossword.weekStatus === "published"}
            started={crossword.students.started}
            onDelete={onDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

function MoveButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={`Move ${label.toLowerCase()}`}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full bg-card text-base ring-1 ring-line transition hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {children}
    </button>
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

function Visibility({ crossword }: { crossword: CrosswordDetail }) {
  let title: string;
  let body: string;
  let tone = "bg-card ring-1 ring-line";
  if (crossword.weekStatus === "draft") {
    title = "This week isn’t published yet";
    body =
      crossword.status === "published"
        ? `Students see this crossword as soon as you publish “${crossword.weekTitle}”.`
        : `Students see nothing in “${crossword.weekTitle}” until you publish the week, which publishes this crossword too.`;
  } else if (crossword.status === "published") {
    title = "Published: students are solving it";
    body = "Changing a clue is fine. Changing the words makes a new grid, and everyone starts again.";
    tone = "bg-highlighter/45";
  } else {
    title = "Draft: students don’t see it yet";
    body = `The rest of “${crossword.weekTitle}” is visible. Publish this crossword when it’s ready.`;
  }
  return (
    <div className={`mt-5 max-w-3xl rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-graphite">{body}</p>
    </div>
  );
}

function PasteWords({ onAdd, onCancel }: { onAdd: (words: { answer: string; clue: string }[], replace: boolean) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const words = parseWordList(text);
  return (
    <div className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A whole list at once</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">Paste words and clues</h2>
      <p className="mt-2 text-[15px] text-graphite">
        One per line: the word, then a dash, a colon or a tab, then the clue. From a document, a spreadsheet or your notes.
      </p>
      <TextArea
        className="mt-5 font-mono text-sm"
        rows={9}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"HTML - The language that gives a page its structure\nBrowser - The program that draws web pages\nServer: The computer that answers a request"}
        aria-label="Words and clues, one per line"
      />
      <p className="mt-2 text-sm text-graphite">
        {words.length === 0 ? "Nothing yet." : `${words.length} word${words.length === 1 ? "" : "s"}${words.some((w) => w.clue === "") ? ", some still without a clue" : ""}.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" disabled={words.length === 0} onClick={() => onAdd(words, true)}>
          Replace the list
        </Button>
        <Button disabled={words.length === 0} onClick={() => onAdd(words, false)}>
          Add them
        </Button>
      </div>
    </div>
  );
}

function DeleteCrossword({
  title,
  published,
  started,
  onDelete,
  onCancel,
}: {
  title: string;
  published: boolean;
  started: number;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Delete this crossword?</h2>
      <p className="mt-3 text-[15px] text-graphite">
        “{title}” will be gone{published ? ", and students stop seeing it" : ""}
        {started > 0 ? `, with what ${started} student${started === 1 ? "" : "s"} filled in` : ""}. This can’t be undone.
      </p>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Keep it
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onDelete();
            } catch (caught) {
              setError(errorMessage(caught));
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete crossword"}
        </Button>
      </div>
    </div>
  );
}
