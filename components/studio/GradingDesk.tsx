"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TaskPlayer } from "@/components/sandbox/TaskPlayer";
import type { LineComment } from "@/components/sandbox/types";
import { Button } from "@/components/ui/buttons";
import { ArrowLeft, ArrowRight, Check } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/lib/useDevice";
import { AnswerCard } from "./QuizReview";
import { Regrade } from "./Submissions";
import { COLOR_TONE, FullScreen, GradeBar, INTEGRITY_CAVEAT, integritySummary, PartPoints } from "./TaskTryout";
import { KIND_LABEL, type AssessmentDetail } from "./types";

/**
 * The grading desk: one assessment's submissions on their own page. Students on
 * the left (to grade first, a search, filters), the selected student's whole
 * attempt on the right (answers with points, code with red-pen notes and part
 * points, the overall score and note), and Save & next to work down the list.
 */

export type DeskRow = FunctionReturnType<typeof api.submissions.forAssessment>["page"][number];
type Filter = "todo" | "graded" | "working" | "all";

const DOT: Record<DeskRow["integrityColor"], string> = { green: "bg-ok", yellow: "bg-warn", red: "bg-red-pen" };

/** Submitted work that still wants the lecturer: never saved by them, an essay without points, or failed grading. */
export function toGrade(row: DeskRow): boolean {
  return row.status === "submitted" && (!row.graded || row.needsGrading || row.gradingError !== undefined);
}

function matches(row: DeskRow, filter: Filter): boolean {
  switch (filter) {
    case "todo":
      return toGrade(row);
    case "graded":
      return row.status === "submitted" && !toGrade(row);
    case "working":
      return row.status === "in_progress";
    case "all":
      return true;
  }
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todo", label: "To grade" },
  { value: "graded", label: "Graded" },
  { value: "working", label: "Still working" },
  { value: "all", label: "All" },
];

/** Scores as a spreadsheet: UTF-8 with a byte-order mark so Excel reads Georgian names. */
export function scoresCsv(rows: DeskRow[]): string {
  const cell = (value: string | number | undefined) => {
    const text = value === undefined ? "" : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    ["Student", "Attempt", "Status", "Submitted", "Score", "Max", "Graded by you", "Integrity"].join(","),
    ...rows.map((row) =>
      [
        cell(row.student),
        cell(row.number),
        cell(row.status === "submitted" ? (row.autoSubmitted ? "submitted (automatically)" : "submitted") : "working"),
        cell(row.submittedAt === undefined ? "" : new Date(row.submittedAt).toLocaleString("en-GB")),
        cell(row.status === "submitted" ? (row.score ?? 0) : ""),
        cell(row.maxScore),
        cell(row.graded ? "yes" : "no"),
        cell(row.integrityColor),
      ].join(","),
    ),
  ];
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Keyboard: J / K move down and up the list, unless the focus is in a field or the code. */
function useListKeys(onNext: () => void, onPrevious: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], .cm-editor")) return;
      if (event.key === "j") onNext();
      else if (event.key === "k") onPrevious();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrevious]);
}

/** The page around the list and the selected student. Takes its data as props, so the dev gallery can show it. */
export function GradingDeskView({
  title,
  kind,
  backHref,
  rows,
  loading,
  selected,
  onSelect,
  student,
  tools,
}: {
  title: string;
  kind: keyof typeof KIND_LABEL;
  backHref: string;
  rows: DeskRow[];
  loading: boolean;
  selected: Id<"attempts"> | null;
  onSelect: (attemptId: Id<"attempts">) => void;
  /** The selected student's work; gets `next` (Save & next) and `previous`. */
  student: (attemptId: Id<"attempts">, next: (() => void) | undefined, previous: (() => void) | undefined) => ReactNode;
  /** Regrade and other actions for the whole assessment. */
  tools?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState("");
  const sorted = useMemo(() => [...rows].sort((a, b) => a.student.localeCompare(b.student, "ka")), [rows]);
  const todo = sorted.filter(toGrade).length;
  // Start where the work is: "To grade" while anything waits, otherwise everyone.
  const active: Filter = filter ?? (todo > 0 ? "todo" : "all");
  const needle = search.trim().toLowerCase();
  const shown = sorted.filter((row) => matches(row, active) && (needle === "" || row.student.toLowerCase().includes(needle)));
  const current = selected ?? shown[0]?.attemptId ?? null;
  const submitted = sorted.filter((row) => row.status === "submitted").length;
  const graded = submitted - todo;

  const step = useCallback(
    (by: 1 | -1) => {
      if (shown.length === 0) return;
      const index = shown.findIndex((row) => row.attemptId === current);
      // A row that just left the filter (graded) still knows where it was: carry on from its neighbours.
      const target = index === -1 ? shown[0] : shown[Math.min(shown.length - 1, Math.max(0, index + by))];
      if (target !== undefined && target.attemptId !== current) onSelect(target.attemptId);
    },
    [shown, current, onSelect],
  );
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);
  useListKeys(next, previous);
  const currentIndex = shown.findIndex((row) => row.attemptId === current);
  const hasNext = currentIndex === -1 ? shown.some((row) => row.attemptId !== current) : currentIndex < shown.length - 1;
  const hasPrevious = currentIndex > 0;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.5rem)]">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[1.8rem] bg-panel px-5 py-4">
        <div className="min-w-0 flex-1">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-graphite hover:text-ink">
            <ArrowLeft className="size-4" />
            Back to the {KIND_LABEL[kind].toLowerCase()}
          </Link>
          <h1 className="truncate text-2xl font-medium tracking-[-0.02em]">Grading · {title}</h1>
        </div>
        <div className="min-w-48">
          <p className="text-sm tabular-nums text-graphite">
            <span className="font-semibold text-ink">{graded}</span> of {submitted} submitted graded
            {todo > 0 && <span className="text-red-pen"> · {todo} to grade</span>}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-500"
              style={{ width: submitted === 0 ? "0%" : `${(graded / submitted) * 100}%` }}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0}
          onClick={() => download(`${title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "scores"}.csv`, scoresCsv(sorted))}
        >
          Export scores (CSV)
        </Button>
      </header>
      {tools}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col rounded-[1.6rem] bg-card p-3" aria-label="Students">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a student"
            aria-label="Find a student"
            className="h-10 rounded-full border border-line bg-paper px-4 text-sm outline-none focus:border-ink"
          />
          <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Show">
            {FILTERS.map((f) => {
              const count = sorted.filter((row) => matches(row, f.value)).length;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active === f.value}
                  onClick={() => setFilter(f.value)}
                  className={`h-8 rounded-full px-3 text-xs font-medium transition ${
                    active === f.value ? "bg-ink text-paper" : "bg-panel text-graphite hover:text-ink"
                  }`}
                >
                  {f.label} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto max-lg:max-h-80">
            {loading && rows.length === 0 ? (
              <li className="px-2 py-6">
                <WritingDots label="Loading students" />
              </li>
            ) : shown.length === 0 ? (
              <li className="px-3 py-6 text-sm leading-relaxed text-graphite">
                {rows.length === 0
                  ? "Nobody has started yet."
                  : active === "todo"
                    ? "Nothing left to grade. Nice work."
                    : "Nobody here."}
              </li>
            ) : (
              shown.map((row) => (
                <li key={row.attemptId}>
                  <button
                    onClick={() => onSelect(row.attemptId)}
                    aria-current={row.attemptId === current ? "true" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition ${
                      row.attemptId === current ? "bg-ink text-paper" : "hover:bg-panel"
                    }`}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${DOT[row.integrityColor]}`}
                      title={`Integrity ${row.integrityColor}. ${INTEGRITY_CAVEAT}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {row.student}
                        {row.number > 1 && <span className="font-normal opacity-70"> · {row.number}</span>}
                      </span>
                      <span className={`block text-xs ${row.attemptId === current ? "text-paper/70" : "text-graphite"}`}>
                        {row.status === "in_progress"
                          ? "Still working"
                          : row.gradingError
                            ? "Grading failed"
                            : row.needsGrading
                              ? "Essay to grade"
                              : row.graded
                                ? "Graded"
                                : row.autoSubmitted
                                  ? "Submitted automatically"
                                  : "Submitted"}
                      </span>
                    </span>
                    {row.status === "submitted" && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {row.score ?? 0}
                        <span className="font-normal opacity-60">/{row.maxScore}</span>
                      </span>
                    )}
                    {row.graded && !toGrade(row) && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 px-2 text-xs text-graphite">
            <kbd className="rounded border border-line px-1">J</kbd> next ·{" "}
            <kbd className="rounded border border-line px-1">K</kbd> previous
          </p>
        </aside>

        <section className="flex min-h-[32rem] min-w-0 flex-col" aria-label="Selected student">
          {current === null ? (
            <div className="grid flex-1 place-items-center rounded-[1.6rem] bg-card p-8 text-center text-graphite">
              {rows.length === 0 ? "Work appears here once students start." : "Pick a student on the left."}
            </div>
          ) : (
            student(current, hasNext ? next : undefined, hasPrevious ? previous : undefined)
          )}
        </section>
      </div>
    </div>
  );
}

/** What the desk shows for a student: the overview (answers, code parts), or one code part full screen. */
export type DeskView = "overview" | Id<"questions">;

/** One student's attempt, live: answers and code parts, and the overall grade. A code part opens full screen. */
type WorkDetail = FunctionReturnType<typeof api.submissions.detail>;

type WorkProps = {
  attemptId: Id<"attempts">;
  /** Kept by the desk across students, so the next student opens on the same code part. */
  view: DeskView;
  onView: (view: DeskView) => void;
  onNext: (() => void) | undefined;
  onPrevious: (() => void) | undefined;
};

export function StudentWork(props: WorkProps) {
  const { attemptId, view, onView } = props;
  const detail = useQuery(api.submissions.detail, { attemptId });
  const addComment = useMutation(api.submissions.addComment);
  const removeComment = useMutation(api.submissions.removeComment);

  if (detail === undefined) {
    // Moving on with a code part open keeps the full-screen layer up while the next student loads.
    return view === "overview" ? (
      <div className="grid flex-1 place-items-center rounded-[1.6rem] bg-card">
        <WritingDots label="Opening their work" />
      </div>
    ) : (
      <FullScreen label="Opening the next student" onClose={() => onView("overview")}>
        <div className="grid h-full place-items-center">
          <WritingDots label="Opening their work" />
        </div>
      </FullScreen>
    );
  }
  return (
    <StudentWorkView
      {...props}
      detail={detail}
      onAddComment={async (questionId, file, line, text) => {
        await addComment({ attemptId, questionId, file, line, text });
      }}
      onDeleteComment={(id) => void removeComment({ commentId: id as Id<"codeComments"> })}
    />
  );
}

/** The student's attempt on screen; takes the attempt as data, so the dev gallery can show it too. */
export function StudentWorkView({
  attemptId,
  detail,
  view,
  onView,
  onNext,
  onPrevious,
  onAddComment,
  onDeleteComment,
}: WorkProps & {
  detail: WorkDetail;
  onAddComment: (questionId: Id<"questions">, file: string, line: number, text: string) => Promise<void>;
  onDeleteComment: (id: string) => void;
}) {
  const allComments = detail.comments;
  const commentsFor = (questionId: Id<"questions">): LineComment[] =>
    allComments
      .filter((c) => c.questionId === questionId)
      .map((c) => ({ id: c._id, file: c.file, line: c.line, text: c.text, author: c.author }));

  const submitted = detail.status === "submitted";
  const partLabel = (index: number) => (detail.questions.length === 1 ? "Code" : `Code · part ${index + 1}`);
  const codeIndex = view === "overview" ? -1 : detail.questions.findIndex((q) => q.questionId === view);
  const code = codeIndex === -1 ? undefined : detail.questions[codeIndex];
  const status = submitted
    ? detail.autoSubmitted
      ? "submitted automatically (time ran out or it closed)"
      : "submitted"
    : "still working (last autosave)";
  const grade = submitted ? (
    <GradeBar
      key={attemptId}
      attemptId={attemptId}
      autoScore={detail.autoScore}
      manualScore={detail.manualScore}
      maxScore={detail.maxScore}
      feedback={detail.feedback}
      onSaveAndNext={onNext}
    />
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] bg-card px-4 py-3 text-sm text-graphite">
      Still working: you can grade once it is submitted (by the student, the timer or the closing time).
      {onNext && (
        <Button size="sm" variant="outline" onClick={onNext}>
          Next student
        </Button>
      )}
    </div>
  );

  // A code part: full screen, laid out like the student's own screen, with grading around it.
  if (code !== undefined) {
    return (
      <FullScreen label={`${detail.student}: ${partLabel(codeIndex)}`} onClose={() => onView("overview")}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <TaskPlayer
              key={`${attemptId}-${code.questionId}`}
              mode="review"
              readOnly
              task={code.code}
              intro={code.prompt}
              initialFiles={code.files ?? code.code.files}
              hiddenChecks={code.hiddenChecks}
              comments={commentsFor(code.questionId)}
              onAddComment={(file, line, text) => onAddComment(code.questionId, file, line, text)}
              onDeleteComment={onDeleteComment}
              header={
                <div className="min-w-0">
                  <p className="truncate text-sm text-graphite">
                    {status}
                    <span title={INTEGRITY_CAVEAT} className="ml-2 align-middle">
                      <Pill tone={COLOR_TONE[detail.integrityColor]}>Integrity: {detail.integrityColor}</Pill>
                    </span>
                  </p>
                  <h2 className="truncate text-2xl font-medium tracking-[-0.02em]">
                    {detail.student}
                    {detail.number > 1 && <span className="text-lg font-normal text-graphite"> · attempt {detail.number}</span>}
                  </h2>
                </div>
              }
              actions={
                <>
                  {detail.questions.length > 1 &&
                    detail.questions.map((q, i) => (
                      <Button key={q.questionId} size="sm" variant={q.questionId === code.questionId ? "ink" : "outline"} onClick={() => onView(q.questionId)}>
                        Part {i + 1}
                      </Button>
                    ))}
                  <Button size="sm" variant="ghost" onClick={onPrevious} disabled={onPrevious === undefined} aria-label="Previous student (K)">
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onNext} disabled={onNext === undefined} aria-label="Next student (J)">
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onView("overview")}>
                    Back to the list
                  </Button>
                </>
              }
              banner={
                <>
                  {detail.gradingError && (
                    <p className="rounded-[1.2rem] bg-red-pen/10 px-4 py-2.5 text-sm text-red-pen">
                      Automatic grading failed ({detail.gradingError}), so this counts as 0 for now. Give points for the part or an
                      overall score, or fix the task and regrade.
                    </p>
                  )}
                  {submitted && (
                    <PartPoints
                      key={`${attemptId}-${code.questionId}-${code.manualPoints ?? "auto"}`}
                      attemptId={attemptId}
                      questionId={code.questionId}
                      part={detail.questions.length > 1 ? codeIndex + 1 : undefined}
                      points={code.points}
                      autoScore={code.autoScore}
                      manualPoints={code.manualPoints}
                      overridden={detail.manualScore !== undefined}
                    />
                  )}
                </>
              }
            />
          </div>
          {grade}
        </div>
      </FullScreen>
    );
  }

  // The overview: who it is, every code part with a way in, then the answers.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-[1.6rem] bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate text-xl font-medium tracking-tight">{detail.student}</h2>
          <span className="text-sm text-graphite">
            {detail.number > 1 && `attempt ${detail.number} · `}
            {status}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-graphite">
          <span title={INTEGRITY_CAVEAT}>
            <Pill tone={COLOR_TONE[detail.integrityColor]}>Integrity: {detail.integrityColor}</Pill>
          </span>
          {integritySummary(detail.integrity)}
        </p>
        {detail.gradingError && (
          <p className="mt-2 rounded-xl bg-red-pen/10 px-3 py-2 text-sm text-red-pen">
            Automatic grading failed ({detail.gradingError}), so this counts as 0 for now. Give points per question or an
            overall score below, or fix the task and regrade.
          </p>
        )}
      </div>

      <div className="min-h-[20rem] flex-1 space-y-3 overflow-y-auto pb-2">
        {detail.questions.map((q, i) => {
          const passed = q.checkResults?.filter((r) => r.passed).length;
          const total = q.checkResults?.length;
          const notes = allComments.filter((c) => c.questionId === q.questionId).length;
          return (
            <div key={q.questionId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[1.6rem] bg-card px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{partLabel(i)}</p>
                <p className="text-sm text-graphite">
                  {q.manualPoints ?? q.autoScore ?? 0} / {q.points} points
                  {q.manualPoints !== undefined && " (yours)"}
                  {passed !== undefined && total !== undefined && ` · ${passed} of ${total} checks`}
                  {notes > 0 && ` · ${notes} red-pen note${notes === 1 ? "" : "s"}`}
                  {q.files === undefined && " · never saved"}
                </p>
              </div>
              <Button size="sm" onClick={() => onView(q.questionId)}>
                Open as the student saw it
              </Button>
            </div>
          );
        })}
        {detail.answers.length > 0 && (
          <ol className="space-y-3">
            {detail.answers.map((answer, index) => (
              <AnswerCard key={answer.questionId} index={index} answer={answer} attemptId={attemptId} gradable={submitted} />
            ))}
          </ol>
        )}
        {detail.questions.length === 0 && detail.answers.length === 0 && (
          <p className="rounded-[1.6rem] bg-card p-6 text-graphite">This attempt has nothing to show yet.</p>
        )}
      </div>

      {grade}
    </div>
  );
}

/** The live desk: every submission of the assessment, loaded page by page until all are in. */
export function GradingDesk({ detail }: { detail: AssessmentDetail }) {
  const { assessment } = detail;
  const { results, status, loadMore } = usePaginatedQuery(
    api.submissions.forAssessment,
    { assessmentId: assessment._id },
    { initialNumItems: 100 },
  );
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(100);
  }, [status, loadMore]);
  const [selected, setSelected] = useState<Id<"attempts"> | null>(null);
  const [view, setView] = useState<DeskView>("overview");
  const mobile = useIsMobile();
  const backHref = `/courses/${assessment.courseId}/assessments/${assessment._id}`;

  if (mobile) {
    return (
      <div className="rounded-[2rem] bg-panel p-8">
        <h1 className="text-2xl font-medium tracking-tight">The grading desk needs a computer</h1>
        <p className="mt-2 text-graphite">Code, answers and the list side by side don&apos;t fit on a phone.</p>
        <Link href={backHref} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium underline">
          <ArrowLeft className="size-4" /> Back
        </Link>
      </div>
    );
  }
  return (
    <GradingDeskView
      title={assessment.title}
      kind={assessment.kind}
      backHref={backHref}
      rows={results}
      loading={status === "LoadingFirstPage"}
      selected={selected}
      onSelect={setSelected}
      tools={results.some((row) => row.status === "submitted") ? <Regrade assessmentId={assessment._id} /> : undefined}
      student={(attemptId, next, previous) => (
        <StudentWork key={attemptId} attemptId={attemptId} view={view} onView={setView} onNext={next} onPrevious={previous} />
      )}
    />
  );
}
