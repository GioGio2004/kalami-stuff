"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Markdown } from "@/components/sandbox/Markdown";
import { Button } from "@/components/ui/buttons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { COLOR_TONE, FullScreen, GradeBar, integritySummary, SubmissionReview } from "./TaskTryout";

type Detail = FunctionReturnType<typeof api.submissions.detail>;
type Answer = Detail["answers"][number];

/** One student's quiz or exam: every answer next to the key, points per answer, the overall grade. */
export function QuizReview({ attemptId, title, onClose }: { attemptId: Id<"attempts">; title: string; onClose: () => void }) {
  const detail = useQuery(api.submissions.detail, { attemptId });
  const [showCode, setShowCode] = useState(false);

  if (showCode) {
    return <SubmissionReview attemptId={attemptId} title={title} onClose={() => setShowCode(false)} />;
  }
  return (
    <FullScreen label="Student answers" onClose={onClose}>
      {detail === undefined ? (
        <div className="grid h-full place-items-center">
          <WritingDots label="Opening their answers" />
        </div>
      ) : (
        <div className="mx-auto flex h-full max-w-4xl flex-col gap-3">
          <header className="flex flex-wrap items-start gap-3 rounded-[1.6rem] bg-panel px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">
                {title}
                {detail.number > 1 && ` · attempt ${detail.number}`}
              </p>
              <h2 className="truncate text-xl font-medium tracking-tight">
                {detail.student}
                <span className="ml-2 text-base font-normal text-graphite">
                  {detail.status === "submitted"
                    ? detail.autoSubmitted
                      ? "submitted automatically when time ran out"
                      : "submitted"
                    : "still working (last autosave)"}
                </span>
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-graphite">
                <Pill tone={COLOR_TONE[detail.integrityColor]}>Integrity: {detail.integrityColor}</Pill>
                {integritySummary(detail.integrity)}
              </p>
            </div>
            {detail.questions.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowCode(true)}>
                Open code answers
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </header>

          <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
            {detail.answers.map((answer, index) => (
              <AnswerCard
                key={answer.questionId}
                index={index}
                answer={answer}
                attemptId={attemptId}
                gradable={detail.status === "submitted"}
              />
            ))}
          </ol>

          {detail.status === "submitted" && (
            <GradeBar
              key={attemptId}
              attemptId={attemptId}
              autoScore={detail.autoScore}
              manualScore={detail.manualScore}
              maxScore={detail.maxScore}
              feedback={detail.feedback}
            />
          )}
        </div>
      )}
    </FullScreen>
  );
}

function AnswerCard({
  index,
  answer,
  attemptId,
  gradable,
}: {
  index: number;
  answer: Answer;
  attemptId: Id<"attempts">;
  gradable: boolean;
}) {
  const { key, value } = answer;
  const points = answer.manualPoints ?? answer.autoScore;
  const correctIds =
    key?.type === "single" ? [key.correctOptionId] : key?.type === "multiple" ? key.correctOptionIds : [];
  const chosen = value?.type === "single" ? [value.optionId] : value?.type === "multiple" ? value.optionIds : [];
  const written = value?.type === "short" || value?.type === "essay" ? value.text : "";

  return (
    <li className="rounded-[1.6rem] bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-graphite">
          Question {index + 1} · {answer.points} point{answer.points === 1 ? "" : "s"}
        </p>
        {answer.type === "essay" && value !== undefined && answer.manualPoints === undefined && gradable && (
          <Pill tone="red">Needs grading</Pill>
        )}
      </div>
      <Markdown source={answer.prompt} className="mt-1 text-[15px] leading-relaxed" />

      {answer.options && (
        <ul className="mt-3 space-y-1.5">
          {answer.options.map((option) => {
            const picked = chosen.includes(option.id);
            const right = correctIds.includes(option.id);
            return (
              <li
                key={option.id}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  picked ? (right ? "bg-highlighter/50" : "bg-red-pen/10") : "bg-panel/60"
                }`}
              >
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-graphite">
                  {picked ? "Picked" : ""}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{option.text}</span>
                {right && <span className="text-xs font-semibold text-ink">correct</span>}
              </li>
            );
          })}
        </ul>
      )}

      {(answer.type === "short" || answer.type === "essay") && (
        <p className={`mt-3 whitespace-pre-wrap rounded-xl bg-panel/60 px-4 py-3 text-[15px] leading-relaxed ${written ? "" : "text-graphite"}`}>
          {written || "No answer"}
        </p>
      )}
      {key?.type === "short" && (
        <p className="mt-2 text-sm text-graphite">Accepted: {key.acceptedAnswers.join(" · ")}</p>
      )}
      {key?.type === "essay" && key.rubric && <p className="mt-2 text-sm text-graphite">Rubric: {key.rubric}</p>}
      {value === undefined && answer.type !== "essay" && answer.type !== "short" && (
        <p className="mt-2 text-sm text-graphite">No answer.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-graphite">
          Points: <span className="font-semibold tabular-nums text-ink">{points ?? "—"}</span> / {answer.points}
          {answer.manualPoints !== undefined && answer.autoScore !== undefined && ` (auto ${answer.autoScore})`}
        </span>
        {gradable && value !== undefined && (
          <PointsInput
            key={`${answer.questionId}:${answer.manualPoints ?? ""}`}
            attemptId={attemptId}
            questionId={answer.questionId}
            max={answer.points}
            manual={answer.manualPoints}
          />
        )}
      </div>
    </li>
  );
}

/** Points a lecturer gives one answer; empty goes back to the automatic points. */
function PointsInput({
  attemptId,
  questionId,
  max,
  manual,
}: {
  attemptId: Id<"attempts">;
  questionId: Id<"questions">;
  max: number;
  manual?: number;
}) {
  const setPoints = useMutation(api.submissions.setQuestionPoints);
  const [text, setText] = useState(manual === undefined ? "" : String(manual));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = text !== (manual === undefined ? "" : String(manual));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setPoints({ attemptId, questionId, points: text.trim() === "" ? undefined : Number(text) });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        max={max}
        step={0.5}
        value={text}
        placeholder="give"
        aria-label="Points for this answer"
        onChange={(e) => setText(e.target.value)}
        className="h-8 w-20 rounded-full border border-line bg-paper px-3 tabular-nums"
      />
      {changed && (
        <Button size="sm" variant="danger" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save points"}
        </Button>
      )}
      {error && <span className="text-red-pen">{error}</span>}
    </span>
  );
}
