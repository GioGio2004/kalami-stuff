"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/buttons";
import { Pill } from "@/components/ui/Pill";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
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

type RegradeResult = { attemptId: Id<"attempts">; student: string; before?: number; after?: number; error?: string };
type RegradePage = { done: boolean; cursor: string; results: RegradeResult[] };

/**
 * Grades every submitted attempt again with the questions as they are now: after
 * fixing a check, a hidden check or the points. The lecturer's own points stay.
 */
export function Regrade({ assessmentId }: { assessmentId: Id<"assessments"> }) {
  const regrade = useMutation(api.submissions.regrade);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [results, setResults] = useState<RegradeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setError(null);
    setResults([]);
    try {
      let cursor: string | null = null;
      const all: RegradeResult[] = [];
      for (;;) {
        const page: RegradePage = await regrade({ assessmentId, cursor });
        all.push(...page.results);
        setResults([...all]);
        if (page.done) break;
        cursor = page.cursor;
      }
      setState("done");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("idle");
    }
  }

  const changed = results.filter((r) => r.before !== r.after || r.error);
  return (
    <div className="mt-3 rounded-[1.4rem] bg-panel px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-graphite">
          Fixed a check or the points? Grade the submitted work again. Points you gave by hand stay.
        </span>
        <Button size="sm" variant="outline" onClick={run} disabled={state === "running"}>
          {state === "running" ? `Regrading… ${results.length}` : "Regrade submitted work"}
        </Button>
      </div>
      {error && <p className="mt-2 text-red-pen">{error}</p>}
      {state === "done" && (
        <div className="mt-2">
          <p className="font-medium">
            {results.length} regraded · {changed.length === 0 ? "no score changed" : `${changed.length} changed`}
          </p>
          {changed.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {changed.slice(0, 50).map((r) => (
                <li key={r.attemptId} className="flex flex-wrap gap-2 tabular-nums">
                  <span className="font-medium">{r.student}</span>
                  {r.error ? (
                    <span className="text-red-pen">grading failed: {r.error}</span>
                  ) : (
                    <span className="text-graphite">
                      {r.before ?? 0} → <span className="text-ink">{r.after ?? 0}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

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
        <Link
          href={`/courses/${detail.assessment.courseId}/assessments/${detail.assessment._id}/grading`}
          className={`ml-auto ${buttonClass("ink", "sm")}`}
        >
          Open the grading desk
        </Link>
      </div>
      {rows.some((row) => row.status === "submitted") && <Regrade assessmentId={detail.assessment._id} />}
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
              const pastes = row.integrity.pasteBlocked + row.integrity.dropBlocked;
              const details = [
                row.status === "submitted" ? "submitted" : "working",
                row.questionsTotal > 0 && `${row.answered} of ${row.questionsTotal} answered`,
                (row.integrity.tabSwitches ?? 0) > 0 && `${row.integrity.tabSwitches} tab switches`,
                pastes > 0 && `${pastes} pastes blocked`,
                row.autoSubmitted && "auto-submitted",
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
                        {details.charAt(0).toUpperCase() + details.slice(1)}
                      </span>
                    </span>
                    {row.status === "submitted" ? (
                      row.gradingError ? (
                        <Pill tone="red">Grading failed</Pill>
                      ) : row.needsGrading ? (
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
            The dot is the integrity colour, from counters the student&apos;s own browser reported: advice, never a verdict,
            and a notification popping up or a laptop going to sleep can move it. Open a row to read the answers,
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
