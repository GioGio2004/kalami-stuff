"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TaskPlayer } from "@/components/sandbox/TaskPlayer";
import type { CodeFile, LineComment, SandboxTask } from "@/components/sandbox/types";
import { Button } from "@/components/ui/buttons";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fill, fillFiles, fillRule, fillTask, sampleCount, sampleValues, SAMPLE_STUDENT } from "@/lib/checks";
import { errorMessage } from "@/lib/errors";
import type { QuestionWithKey } from "./types";

/** A full-screen layer over the studio (native <dialog>: Escape and focus trapping for free). */
export function FullScreen({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-paper p-3 text-ink sm:p-5"
    >
      {children}
    </dialog>
  );
}

/** The solution as a student would end up with it: starter files it leaves out stay as they were. */
function solutionOf(question: QuestionWithKey): CodeFile[] | undefined {
  if (question.key.type !== "code" || !question.code) return undefined;
  const solved = new Map(question.key.solution.map((f) => [f.name, f.content]));
  return question.code.files.map((f) => ({ name: f.name, content: solved.get(f.name) ?? f.content }));
}

/** Lecturer mode: work through the task exactly as a student would, or load the solution. */
export function TaskTryout({ question, title, onClose }: { question: QuestionWithKey; title: string; onClose: () => void }) {
  const variables = useMemo(() => question.code?.variables ?? [], [question.code]);
  const combos = sampleCount(variables);
  const [variant, setVariant] = useState(0);
  const values = useMemo(() => sampleValues(variables, variant), [variables, variant]);
  if (!question.code) return null;
  const task: SandboxTask = fillTask(
    { files: question.code.files, steps: question.code.steps, assets: question.code.assets },
    values,
  );
  const solution = solutionOf(question);
  return (
    <FullScreen label={`Try “${title}”`} onClose={onClose}>
      <TaskPlayer
        key={variant}
        mode="lecturer"
        task={task}
        intro={fill(question.prompt, values)}
        initialFiles={task.files}
        hiddenChecks={question.key.type === "code" ? question.key.hiddenChecks.map((rule) => fillRule(rule, values)) : []}
        solution={solution && fillFiles(solution, values)}
        header={
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">
              Trying it as {SAMPLE_STUDENT.firstName} {SAMPLE_STUDENT.lastName}, a sample student
            </p>
            <h2 className="truncate text-xl font-medium tracking-tight">{title}</h2>
          </div>
        }
        actions={
          <>
            {variables.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-graphite">
                Variant
                <select
                  value={variant}
                  onChange={(e) => setVariant(Number(e.target.value))}
                  className="h-9 rounded-full border border-line bg-card px-3 text-sm text-ink"
                >
                  {Array.from({ length: combos }, (_, k) => (
                    <option key={k} value={k}>
                      {variables.map((v) => sampleValues([v], k)[v.name]).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
    </FullScreen>
  );
}

const COLOR_TONE: Record<"green" | "yellow" | "red", PillTone> = { green: "ok", yellow: "lime", red: "red" };

function integritySummary(c: {
  pasteBlocked: number;
  dropBlocked: number;
  largeInserts: number;
  tabSwitches?: number;
  awayMs?: number;
  fullscreenExits?: number;
  copyBlocked?: number;
  multiTab?: number;
}): string {
  const parts = [
    c.tabSwitches && `${c.tabSwitches} tab switch${c.tabSwitches === 1 ? "" : "es"}`,
    c.awayMs && `${Math.round(c.awayMs / 1000)} s away`,
    c.fullscreenExits && `${c.fullscreenExits} fullscreen exit${c.fullscreenExits === 1 ? "" : "s"}`,
    c.pasteBlocked + c.dropBlocked > 0 && `${c.pasteBlocked + c.dropBlocked} paste${c.pasteBlocked + c.dropBlocked === 1 ? "" : "s"} blocked`,
    c.largeInserts && `${c.largeInserts} large insert${c.largeInserts === 1 ? "" : "s"}`,
    c.copyBlocked && `${c.copyBlocked} copy attempt${c.copyBlocked === 1 ? "" : "s"}`,
    c.multiTab && `opened in ${c.multiTab + 1} tabs`,
  ].filter(Boolean);
  return parts.length === 0 ? "Nothing unusual" : parts.join(" · ");
}

/** The overall note and a score that replaces the automatic one. */
function GradeBar({
  attemptId,
  autoScore,
  manualScore,
  maxScore,
  feedback,
}: {
  attemptId: Id<"attempts">;
  autoScore?: number;
  manualScore?: number;
  maxScore: number;
  feedback?: string;
}) {
  const setGrade = useMutation(api.submissions.setGrade);
  const [score, setScore] = useState(manualScore === undefined ? "" : String(manualScore));
  const [note, setNote] = useState(feedback ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await setGrade({
        attemptId,
        feedback: note,
        manualScore: score.trim() === "" ? undefined : Number(score),
      });
      setState("saved");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[1.4rem] bg-card px-4 py-3">
      <span className="text-sm text-graphite">
        Auto score <span className="font-semibold tabular-nums text-ink">{autoScore ?? 0}</span> / {maxScore}
      </span>
      <label className="flex items-center gap-2 text-sm">
        Score
        <input
          type="number"
          min={0}
          max={maxScore}
          step={0.5}
          value={score}
          placeholder={String(autoScore ?? 0)}
          onChange={(e) => {
            setScore(e.target.value);
            setState("idle");
          }}
          className="h-9 w-20 rounded-full border border-line bg-paper px-3 tabular-nums"
        />
      </label>
      <input
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setState("idle");
        }}
        maxLength={4000}
        placeholder="Overall note for the student"
        className="h-9 min-w-48 flex-1 rounded-full border border-line bg-paper px-4 font-hand text-lg text-red-pen placeholder:font-sans placeholder:text-sm placeholder:text-graphite/60"
      />
      <Button size="sm" variant="danger" onClick={save} disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save grade"}
      </Button>
      {error && <span className="w-full text-sm text-red-pen">{error}</span>}
    </div>
  );
}

/** Review mode: a student's saved or submitted code, read-only, with every check and red-pen notes. */
export function SubmissionReview({
  attemptId,
  title,
  onClose,
}: {
  attemptId: Id<"attempts">;
  title: string;
  onClose: () => void;
}) {
  const detail = useQuery(api.submissions.detail, { attemptId });
  const addComment = useMutation(api.submissions.addComment);
  const removeComment = useMutation(api.submissions.removeComment);
  const [index, setIndex] = useState(0);
  const question = detail?.questions[index];

  const comments: LineComment[] = useMemo(
    () =>
      (detail?.comments ?? [])
        .filter((c) => c.questionId === question?.questionId)
        .map((c) => ({ id: c._id, file: c.file, line: c.line, text: c.text, author: c.author })),
    [detail?.comments, question?.questionId],
  );

  return (
    <FullScreen label="Student work" onClose={onClose}>
      {detail === undefined ? (
        <div className="grid h-full place-items-center">
          <WritingDots label="Opening their work" />
        </div>
      ) : question === undefined ? (
        <div className="grid h-full place-items-center">
          <p className="text-graphite">This attempt has no code questions.</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <TaskPlayer
          key={question.questionId}
          mode="review"
          readOnly
          task={question.code}
          intro={question.prompt}
          initialFiles={question.files ?? question.code.files}
          hiddenChecks={question.hiddenChecks}
          comments={comments}
          onAddComment={async (file, line, text) => {
            await addComment({ attemptId, questionId: question.questionId, file, line, text });
          }}
          onDeleteComment={(id) => void removeComment({ commentId: id as Id<"codeComments"> })}
          header={
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">{title}</p>
              <h2 className="truncate text-xl font-medium tracking-tight">
                {detail.student}
                <span className="ml-2 text-base font-normal text-graphite">
                  {detail.status === "submitted"
                    ? detail.autoSubmitted
                      ? "submitted automatically when the task closed"
                      : "submitted"
                    : "still working (last autosave)"}
                </span>
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-graphite">
                <Pill tone={COLOR_TONE[detail.integrityColor]}>Integrity: {detail.integrityColor}</Pill>
                {integritySummary(detail.integrity)}
              </p>
            </div>
          }
          actions={
            <>
              {detail.questions.length > 1 &&
                detail.questions.map((q, i) => (
                  <Button key={q.questionId} size="sm" variant={i === index ? "ink" : "outline"} onClick={() => setIndex(i)}>
                    Part {i + 1}
                  </Button>
                ))}
              <Button size="sm" variant="outline" onClick={onClose}>
                Close
              </Button>
            </>
          }
          banner={
            detail.status === "submitted" ? (
              <GradeBar
                key={attemptId}
                attemptId={attemptId}
                autoScore={detail.autoScore}
                manualScore={detail.manualScore}
                maxScore={detail.maxScore}
                feedback={detail.feedback}
              />
            ) : undefined
          }
        />
      )}
    </FullScreen>
  );
}
