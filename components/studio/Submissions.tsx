"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/buttons";
import { Pill } from "@/components/ui/Pill";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/lib/useDevice";
import { OnComputer } from "./OnComputer";
import { QuizReview } from "./QuizReview";
import { SubmissionReview } from "./TaskTryout";
import type { AssessmentDetail } from "./types";

const DOT: Record<"green" | "yellow" | "red", string> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-red-pen",
};

/** Rows per page: the list stays cheap however big the class is. */
const PAGE_SIZE = 50;

/** Who has started, how far they are, integrity and score. Live, a page at a time. */
export function Submissions({ detail }: { detail: AssessmentDetail }) {
  const { results: rows, status, loadMore } = usePaginatedQuery(
    api.submissions.forAssessment,
    { assessmentId: detail.assessment._id },
    { initialNumItems: PAGE_SIZE },
  );
  const [open, setOpen] = useState<Id<"attempts"> | null>(null);
  const codeOnly = detail.questions.length > 0 && detail.questions.every((q) => q.type === "code");
  const mobile = useIsMobile();
  const loading = status === "LoadingFirstPage";

  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-medium tracking-tight">Student work</h2>
        <span className="rounded-full bg-panel px-3 py-1 text-sm tabular-nums text-graphite">
          {loading ? "…" : `${rows.length}${status === "CanLoadMore" ? "+" : ""}`}
        </span>
      </div>
      {loading ? null : rows.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-graphite">
          {detail.assessment.status === "published"
            ? "Nobody has started yet. Work appears here live as students save."
            : "Students can start once you publish it (and the course is published)."}
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line">
            {rows.map((row) => {
              const progress = [
                row.questionsTotal > 0 && `${row.answered} of ${row.questionsTotal} answered`,
                row.stepsTotal > 0 &&
                  (row.stepsDone >= row.stepsTotal ? "every step done" : `step ${row.stepsDone + 1} of ${row.stepsTotal}`),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={row.attemptId}>
                  <button
                    onClick={() => setOpen(row.attemptId)}
                    className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-panel/50"
                  >
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${DOT[row.integrityColor]}`}
                      title={`Integrity ${row.integrityColor} (score ${row.integrityScore})`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.student}
                        {row.number > 1 && <span className="font-normal text-graphite"> · attempt {row.number}</span>}
                      </span>
                      <span className="block text-xs text-graphite">
                        {progress.charAt(0).toUpperCase() + progress.slice(1)}
                        {(row.integrity.tabSwitches ?? 0) > 0 && ` · ${row.integrity.tabSwitches} tab switches`}
                        {row.integrity.pasteBlocked + row.integrity.dropBlocked > 0 &&
                          ` · ${row.integrity.pasteBlocked + row.integrity.dropBlocked} pastes blocked`}
                        {row.autoSubmitted && " · auto-submitted"}
                      </span>
                    </span>
                    {row.status === "submitted" ? (
                      row.needsGrading ? (
                        <Pill tone="red">Needs grading</Pill>
                      ) : (
                        <Pill tone={row.graded ? "ink" : "lime"}>
                          {row.score ?? 0} / {row.maxScore}
                          {row.graded && " ✓"}
                        </Pill>
                      )
                    ) : (
                      <Pill>Working</Pill>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {status !== "Exhausted" && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(PAGE_SIZE)}
            >
              {status === "LoadingMore" ? "Loading…" : "Show more"}
            </Button>
          )}
          <p className="mt-3 text-xs leading-relaxed text-graphite">
            The dot is the integrity colour: advice from the counters, never a verdict. Open a row to read the answers,
            {codeOnly ? " leave red-pen notes" : " give points for written answers"} and grade.
          </p>
        </>
      )}
      {open !== null &&
        (codeOnly && mobile ? (
          <OnComputer what="Reviewing code" onClose={() => setOpen(null)} />
        ) : codeOnly ? (
          <SubmissionReview attemptId={open} title={detail.assessment.title} onClose={() => setOpen(null)} />
        ) : (
          <QuizReview attemptId={open} title={detail.assessment.title} onClose={() => setOpen(null)} />
        ))}
    </section>
  );
}
