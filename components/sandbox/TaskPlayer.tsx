"use client";

import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { runChecks, type CheckResult, type CheckRule } from "@/lib/checks";
import type { Locale } from "./assist/dictionary";
import { CodeEditor } from "./CodeEditor";
import { ArrowLeft, ArrowRight, Bulb, Desktop, EyeOff, ImageIcon, Lock, Pen, Phone, Refresh } from "./icons";
import { Markdown } from "./Markdown";
import { Preview } from "./Preview";
import type { CodeFile, IntegrityEvent, LineComment, SandboxTask } from "./types";

// Shared empty values: a fresh `[]` on every render would make every memo below recompute.
const NO_COMMENTS: LineComment[] = [];
const NO_RULES: CheckRule[] = [];
const NO_RESULTS: { id: string; label: string; passed: boolean }[] = [];

const LABELS = {
  notes: { ka: "ლექტორის შენიშვნები", en: "Notes from your lecturer" },
  hover: {
    ka: "მიიტანე მაუსი ტეგზე ან თვისებაზე, რომ ახსნა ნახო.",
    en: "Rest the mouse on a tag or property to see what it does.",
  },
  stepDone: { ka: "ნაბიჯი შესრულდა", en: "Step done" },
  allDone: { ka: "ყველა ნაბიჯი შესრულდა!", en: "Every step done!" },
  onSubmit: {
    ka: "ეს შემოწმდება, როცა ნამუშევარს გააგზავნი.",
    en: "These are checked when you submit.",
  },
} satisfies Record<string, Record<Locale, string>>;

/**
 * The code sandbox: steps on the left (freeCodeCamp-style, ticked live as the
 * student types), the files in the middle, the page on the right. On narrow
 * screens one panel shows at a time. The same component serves students,
 * lecturers testing a task, and lecturers reviewing a submission.
 *
 * In exams (`checks="on_submit"`) every step is open from the start and the
 * checks show what will be graded, without ticks; `help={false}` takes away
 * hints and the hover explanations.
 */

type Mode = "student" | "lecturer" | "review";
type Pane = "steps" | "code" | "preview";

const PHONE_WIDTH = 375;

function firstFailingStep(task: SandboxTask, results: Map<string, CheckResult>): number {
  const index = task.steps.findIndex((step) => step.checks.some((c) => !results.get(c.id)?.passed));
  return index === -1 ? task.steps.length : index;
}

function watermarkStyle(name: string) {
  const safe = name.replace(/[<>&'"]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='150'><text x='20' y='90' transform='rotate(-16 150 75)' fill='rgba(20,20,20,0.07)' font-size='15' font-family='sans-serif'>${safe}</text></svg>`;
  return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` };
}

function Tick({ passed }: { passed: boolean }) {
  return (
    <span
      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full transition-colors ${
        passed ? "bg-highlighter text-ink" : "border-[1.5px] border-line bg-card"
      }`}
    >
      {passed && (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
          <motion.path
            d="M5 12.5l4.5 4.5L19 7"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        </svg>
      )}
    </span>
  );
}

function CheckList({
  rules,
  results,
  showDetail,
  live,
}: {
  rules: { id: string; label: string }[];
  results: Map<string, { passed: boolean; detail?: string }>;
  showDetail: boolean;
  /** False: what will be checked, without ticks (exams). */
  live: boolean;
}) {
  return (
    <ul className="space-y-2.5">
      {rules.map((rule) => {
        const result = results.get(rule.id);
        const passed = result?.passed ?? false;
        return (
          <li key={rule.id} className="flex gap-2.5 text-sm">
            {live ? <Tick passed={passed} /> : <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-graphite/50" />}
            <span className="min-w-0">
              <span className={passed || !live ? "text-ink" : "text-ink/80"}>{rule.label}</span>
              {live && showDetail && !passed && result?.detail && (
                <span className="mt-0.5 block text-xs leading-relaxed text-graphite">{result.detail}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A short burst when a step turns done: a few dots fly out of the tick. */
function Burst() {
  const dots = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    return { x: Math.cos(angle) * 34, y: Math.sin(angle) * 22, color: i % 3 === 0 ? "var(--red-pen)" : i % 3 === 1 ? "var(--ink)" : "var(--highlighter)" };
  });
  return (
    <span aria-hidden className="pointer-events-none absolute left-4 top-1/2">
      {dots.map((dot, i) => (
        <motion.span
          key={i}
          className="absolute size-1.5 rounded-full"
          style={{ backgroundColor: dot.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: dot.x, y: dot.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      ))}
    </span>
  );
}

export const TaskPlayer = memo(function TaskPlayer({
  task,
  intro,
  initialFiles,
  mode,
  readOnly = false,
  watermark,
  header,
  actions,
  banner,
  hiddenChecks = NO_RULES,
  hiddenResults = NO_RESULTS,
  solution,
  locale = "en",
  comments = NO_COMMENTS,
  checks = "live",
  help = true,
  openSteps = false,
  autoClose = false,
  suggest = false,
  onAddComment,
  onDeleteComment,
  onFilesChange,
  onIntegrity,
  onSaveNow,
}: {
  task: SandboxTask;
  /** Markdown shown before the first step: what the student builds. */
  intro?: string;
  /** Read when the player opens (and keyed remounts); later changes are ignored. */
  initialFiles: CodeFile[];
  mode: Mode;
  readOnly?: boolean;
  /** The student's name over the editor and preview (standard and strict integrity). */
  watermark?: string;
  header?: ReactNode;
  actions?: ReactNode;
  /** A line above the panels, e.g. results after submitting. */
  banner?: ReactNode;
  /** Lecturer and review modes: the hidden checks, run live. */
  hiddenChecks?: CheckRule[];
  /** Student after full results: hidden checks as graded by the server. */
  hiddenResults?: { id: string; label: string; passed: boolean }[];
  /** Lecturer mode: lets them load the solution to see every step pass. */
  solution?: CodeFile[];
  /** Language of the hover explanations. */
  locale?: Locale;
  /** Red-pen notes on lines, shown under the lines they belong to. */
  comments?: LineComment[];
  /** Students: tick checks while typing ("live"), or list them and grade on submit ("on_submit"). */
  checks?: "live" | "on_submit";
  /** Students: hints and hover explanations. */
  help?: boolean;
  /** Every step can be opened from the start (always so when checks wait for submit). */
  openSteps?: boolean;
  /** Typing aids the lecturer allowed: `<h1>` closes itself; `<` lists the tags. */
  autoClose?: boolean;
  suggest?: boolean;
  /** Review mode: clicking a line number starts a note on it. */
  onAddComment?: (file: string, line: number, text: string) => Promise<void>;
  onDeleteComment?: (id: string) => void;
  onFilesChange?: (files: CodeFile[]) => void;
  onIntegrity?: (event: IntegrityEvent) => void;
  onSaveNow?: () => void;
}) {
  const student = mode === "student";
  // Ticks only while working; finished work (read only) shows its results.
  const live = !student || checks === "live" || readOnly;
  const assist = !student || help;
  const allOpen = !student || openSteps || checks === "on_submit";

  const [files, setFiles] = useState(initialFiles);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(initialFiles[0]?.name ?? "index.html");
  const [checked, setChecked] = useState(initialFiles);
  const [pane, setPane] = useState<Pane>("steps");
  const [phone, setPhone] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [draft, setDraft] = useState<{ file: string; line: number; text: string; saving: boolean } | null>(null);

  // Only what is shown gets computed: no checks without ticks.
  const visibleRules = useMemo(() => task.steps.flatMap((s) => s.checks), [task]);
  const results = useMemo(
    () => (live ? new Map(runChecks(checked, [...visibleRules, ...hiddenChecks]).map((r) => [r.id, r])) : new Map<string, CheckResult>()),
    [live, checked, visibleRules, hiddenChecks],
  );
  const firstFailing = live ? firstFailingStep(task, results) : 0;
  const lastStep = task.steps.length - 1;
  const stepDone = (i: number) => live && task.steps[i].checks.every((c) => results.get(c.id)?.passed);
  const doneFlags = task.steps.map((_, i) => stepDone(i));
  const doneCount = doneFlags.filter(Boolean).length;
  const allDone = live && doneCount === task.steps.length;

  const [furthest, setFurthest] = useState(() => (allOpen ? lastStep : Math.min(firstFailing, lastStep)));
  const [stepIndex, setStepIndex] = useState(() => (student && live ? Math.min(firstFailing, lastStep) : 0));
  const step = task.steps[stepIndex];
  const stepPasses = !live || allOpen || step.checks.every((c) => results.get(c.id)?.passed);

  // A step that turns done while the student types gets a moment; steps done on arrival don't.
  const doneKey = doneFlags.map((d) => (d ? "1" : "0")).join("");
  const [seenDone, setSeenDone] = useState(doneKey);
  const [celebrate, setCelebrate] = useState<{ step: number; all: boolean; at: number } | null>(null);
  if (doneKey !== seenDone) {
    setSeenDone(doneKey);
    const newly = doneFlags.findIndex((d, i) => d && seenDone[i] !== "1");
    if (student && !readOnly && newly !== -1) {
      setCelebrate({ step: newly, all: doneFlags.every(Boolean), at: (celebrate?.at ?? 0) + 1 });
    }
  }
  useEffect(() => {
    if (celebrate === null) return;
    const timer = setTimeout(() => setCelebrate(null), celebrate.all ? 3200 : 1800);
    return () => clearTimeout(timer);
  }, [celebrate]);

  // Checks run a moment after typing stops; Ctrl+Enter runs them at once.
  useEffect(() => {
    const timer = setTimeout(() => setChecked(files), 250);
    return () => clearTimeout(timer);
  }, [files]);

  // Tell the parent (autosave) about every edit, but not about the files it gave us.
  const onFilesChangeRef = useRef(onFilesChange);
  const reported = useRef(initialFiles);
  useEffect(() => {
    onFilesChangeRef.current = onFilesChange;
  });
  useEffect(() => {
    if (files !== reported.current) {
      reported.current = files;
      onFilesChangeRef.current?.(files);
    }
  }, [files]);

  function updateFile(name: string, content: string) {
    setFiles((previous) => previous.map((f) => (f.name === name ? { ...f, content } : f)));
  }

  function load(next: CodeFile[]) {
    setFiles(next);
    setChecked(next);
    setRevision((r) => r + 1);
  }

  function blockCopy(event: ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    onIntegrity?.("copyBlocked");
  }

  function runNow() {
    setChecked(files);
    setRefreshKey((k) => k + 1);
  }

  function goTo(index: number) {
    setStepIndex(index);
    setHintOpen(false);
    setPane("steps");
  }

  function next() {
    if (!stepPasses || stepIndex >= lastStep) return;
    setFurthest((f) => Math.max(f, stepIndex + 1));
    goTo(stepIndex + 1);
  }

  const locked = student && !readOnly;
  const activeComments = useMemo(() => comments.filter((c) => c.file === active), [comments, active]);
  const overlay = watermark ? watermarkStyle(watermark) : undefined;
  const hiddenMap = useMemo(() => new Map(hiddenResults.map((r) => [r.id, { passed: r.passed }])), [hiddenResults]);

  const panelClass = (which: Pane) =>
    `${pane === which ? "flex" : "hidden"} min-h-0 flex-col overflow-hidden rounded-[1.6rem] bg-card lg:flex`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {(header || actions) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
          <div className="min-w-0 flex-1">{header}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      {banner}

      {/* Narrow screens: one panel at a time. */}
      <div role="tablist" aria-label="Sandbox panels" className="grid grid-cols-3 gap-1 rounded-full bg-panel p-1 lg:hidden">
        {(["steps", "code", "preview"] as const).map((which) => (
          <button
            key={which}
            role="tab"
            aria-selected={pane === which}
            onClick={() => setPane(which)}
            className={`h-9 rounded-full text-sm font-medium capitalize transition ${
              pane === which ? "bg-ink text-paper" : "text-graphite"
            }`}
          >
            {which === "steps" ? `Step ${stepIndex + 1}/${task.steps.length}` : which}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(18rem,23rem)_minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Steps */}
        <section
          aria-label="Steps"
          className={`relative ${panelClass("steps")} ${student ? "select-none" : ""}`}
          // Students type the task themselves: the text can't be copied out (KALAMI.md §6.1).
          onCopy={student ? blockCopy : undefined}
          onCut={student ? blockCopy : undefined}
          onContextMenu={student ? (event) => event.preventDefault() : undefined}
        >
          <div className="relative border-b border-line px-5 pb-4 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-graphite">
                Step {stepIndex + 1} of {task.steps.length}
              </p>
              {live && <p className="text-xs tabular-nums text-graphite">{doneCount} done</p>}
            </div>
            {live && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
                <motion.div
                  className={`h-full rounded-full ${allDone ? "bg-highlighter" : "bg-ink"}`}
                  initial={false}
                  animate={{ width: `${(doneCount / task.steps.length) * 100}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 20 }}
                />
              </div>
            )}
            <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="All steps">
              {task.steps.map((s, i) => {
                const done = doneFlags[i];
                const reachable = allOpen || i <= furthest;
                return (
                  <li key={i}>
                    <motion.button
                      onClick={() => reachable && goTo(i)}
                      disabled={!reachable}
                      aria-current={i === stepIndex ? "step" : undefined}
                      aria-label={`Step ${i + 1}: ${s.title}${done ? ", done" : ""}`}
                      animate={celebrate?.step === i ? { scale: [1, 1.35, 1] } : { scale: 1 }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                      className={`grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors ${
                        i === stepIndex
                          ? "bg-ink text-paper"
                          : done && reachable
                            ? "bg-highlighter text-ink"
                            : reachable
                              ? "bg-panel text-ink hover:bg-panel-strong"
                              : "bg-panel/60 text-graphite/50"
                      }`}
                    >
                      {i + 1}
                    </motion.button>
                  </li>
                );
              })}
            </ol>
            <AnimatePresence>
              {celebrate !== null && (
                <motion.div
                  key={celebrate.at}
                  role="status"
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                  className={`absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold shadow-[0_10px_24px_-12px_rgba(20,20,20,0.45)] ${
                    celebrate.all ? "bg-ink text-highlighter" : "bg-highlighter text-ink"
                  }`}
                >
                  <Burst />
                  {celebrate.all ? LABELS.allDone[locale] : `${LABELS.stepDone[locale]} · ${celebrate.step + 1}`}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {intro && stepIndex === 0 && (
              <div className="mb-5 rounded-2xl bg-panel p-4 text-[15px] leading-relaxed">
                <Markdown source={intro} />
              </div>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stepIndex}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <h2 className="text-2xl font-medium leading-tight tracking-[-0.02em]">{step.title}</h2>
                <Markdown source={step.instructions} className="mt-3 text-[15px] leading-relaxed text-ink/85" />

                <div className="mt-6">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-graphite">Checks</p>
                  <CheckList rules={step.checks} results={results} showDetail live={live} />
                  {!live && <p className="mt-3 text-xs text-graphite">{LABELS.onSubmit[locale]}</p>}
                </div>

                {assist && step.hint && (
                  <div className="mt-5">
                    {hintOpen ? (
                      <div className="rounded-2xl border border-line p-4 text-sm leading-relaxed">
                        <p className="mb-1 flex items-center gap-1.5 font-medium">
                          <Bulb className="size-4" /> Hint
                        </p>
                        <Markdown source={step.hint} />
                      </div>
                    ) : (
                      <button
                        onClick={() => setHintOpen(true)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-graphite underline-offset-4 hover:text-ink hover:underline"
                      >
                        <Bulb className="size-4" />
                        Need a hint?
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {task.assets.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-graphite">
                  <ImageIcon className="size-4" /> Images you can use
                </p>
                <ul className="grid grid-cols-2 gap-2">
                  {task.assets.map((asset) => (
                    <li key={asset.name} className="overflow-hidden rounded-xl border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element -- task images are ImageKit URLs, already sized */}
                      <img src={asset.url} alt={asset.alt ?? ""} className="aspect-[4/3] w-full bg-panel object-cover" />
                      <p className="truncate px-2 py-1.5 font-mono text-xs">{asset.name}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(hiddenChecks.length > 0 || hiddenResults.length > 0) && (
              <div className="mt-6 rounded-2xl border border-dashed border-line p-4">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-graphite">
                  <EyeOff className="size-4" /> Checked on submit
                </p>
                <CheckList
                  rules={hiddenChecks.length > 0 ? hiddenChecks : hiddenResults}
                  results={hiddenChecks.length > 0 ? results : hiddenMap}
                  showDetail={!student}
                  live
                />
              </div>
            )}

            {comments.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-pen">
                  <Pen className="size-4" /> {LABELS.notes[locale]} ({comments.length})
                </p>
                <ul className="space-y-1.5">
                  {comments.map((comment) => (
                    <li key={comment.id}>
                      <button
                        onClick={() => {
                          setActive(comment.file);
                          setPane("code");
                        }}
                        className="w-full rounded-xl p-2 text-left transition hover:bg-panel"
                      >
                        <span className="block font-mono text-xs text-graphite">
                          {comment.file}:{comment.line}
                        </span>
                        <span className="block font-hand text-xl leading-tight text-red-pen">{comment.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {assist && <p className="mt-6 text-xs leading-relaxed text-graphite">{LABELS.hover[locale]}</p>}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
            <Button variant="ghost" size="sm" onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            {stepIndex < lastStep ? (
              <Button variant={stepPasses && (live ? stepDone(stepIndex) : true) ? "lime" : "outline"} size="sm" onClick={next} disabled={!stepPasses}>
                Next step
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <span className={`text-sm font-medium ${allDone ? "text-ok" : "text-graphite"}`}>
                {allDone ? "Every step done" : "Last step"}
              </span>
            )}
          </div>
        </section>

        {/* Code */}
        <section aria-label="Code" className={panelClass("code")}>
          <div className="flex items-center gap-1 border-b border-line px-3 py-2">
            {files.map((file) => (
              <button
                key={file.name}
                onClick={() => setActive(file.name)}
                className={`h-8 rounded-full px-3.5 font-mono text-[13px] transition ${
                  active === file.name ? "bg-ink text-paper" : "text-graphite hover:bg-panel hover:text-ink"
                }`}
              >
                {file.name}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-graphite">
              {readOnly ? (
                <>
                  <Lock className="size-3.5" /> Read only
                </>
              ) : locked ? (
                "Type it yourself: paste is off"
              ) : null}
            </span>
          </div>
          {mode === "lecturer" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel/60 px-3 py-2 text-xs">
              <span className="text-graphite">Try it as a student, or load</span>
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => load(task.files)}>
                Starter files
              </Button>
              {solution && (
                <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => load(solution)}>
                  Solution
                </Button>
              )}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            <CodeEditor
              files={files}
              active={active}
              revision={revision}
              readOnly={readOnly}
              locked={locked}
              locale={locale}
              assist={assist}
              autoClose={autoClose}
              suggest={suggest}
              comments={activeComments}
              onChange={updateFile}
              onIntegrity={onIntegrity}
              onRun={runNow}
              onSave={onSaveNow}
              onLineClick={onAddComment ? (line) => setDraft({ file: active, line, text: "", saving: false }) : undefined}
              onDeleteComment={onDeleteComment}
            />
            {overlay && <div aria-hidden className="pointer-events-none absolute inset-0" style={overlay} />}
            {draft && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!onAddComment || draft.text.trim() === "") return;
                  setDraft({ ...draft, saving: true });
                  try {
                    await onAddComment(draft.file, draft.line, draft.text);
                    setDraft(null);
                  } catch {
                    setDraft({ ...draft, saving: false });
                  }
                }}
                className="absolute inset-x-3 bottom-3 z-10 rounded-2xl border border-line bg-card p-3 shadow-[0_20px_40px_-20px_rgba(20,20,20,0.45)]"
              >
                <label htmlFor="redpen-note" className="text-xs font-medium text-red-pen">
                  Red-pen note on {draft.file}, line {draft.line}
                </label>
                <textarea
                  id="redpen-note"
                  autoFocus
                  rows={2}
                  maxLength={1000}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  className="mt-1.5 block w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 font-hand text-xl leading-tight text-red-pen outline-none focus:border-red-pen"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={draft.saving}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" variant="danger" disabled={draft.saving || draft.text.trim() === ""}>
                    {draft.saving ? "Saving…" : "Add note"}
                  </Button>
                </div>
              </form>
            )}
          </div>
          {onAddComment && !draft && (
            <p className="border-t border-line px-3 py-2 text-xs text-graphite">Click a line number to leave a red-pen note.</p>
          )}
        </section>

        {/* Preview */}
        <section aria-label="Preview" className={panelClass("preview")}>
          <div className="flex items-center gap-1 border-b border-line px-3 py-2">
            <p className="px-2 text-sm font-medium">Preview</p>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setPhone(false)}
                aria-pressed={!phone}
                aria-label="Desktop width"
                className={`grid size-8 place-items-center rounded-full transition ${!phone ? "bg-panel text-ink" : "text-graphite hover:text-ink"}`}
              >
                <Desktop className="size-4" />
              </button>
              <button
                onClick={() => setPhone(true)}
                aria-pressed={phone}
                aria-label="Phone width"
                className={`grid size-8 place-items-center rounded-full transition ${phone ? "bg-panel text-ink" : "text-graphite hover:text-ink"}`}
              >
                <Phone className="size-4" />
              </button>
              <button
                onClick={runNow}
                aria-label="Refresh preview (Ctrl+Enter)"
                title="Refresh (Ctrl+Enter)"
                className="grid size-8 place-items-center rounded-full text-graphite transition hover:text-ink"
              >
                <Refresh className="size-4" />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <Preview files={files} assets={task.assets} width={phone ? PHONE_WIDTH : undefined} refreshKey={refreshKey} />
            {overlay && <div aria-hidden className="pointer-events-none absolute inset-0" style={overlay} />}
          </div>
        </section>
      </div>
    </div>
  );
});
