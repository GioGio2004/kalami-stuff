"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SubmissionReview } from "./TaskTryout";
import type { AssessmentDetail } from "./types";

const DOT: Record<"green" | "yellow" | "red", string> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-red-pen",
};

/** Who has started a code task, how far they are, integrity and score. Live. */
export function Submissions({ detail }: { detail: AssessmentDetail }) {
  const rows = useQuery(api.submissions.forAssessment, { assessmentId: detail.assessment._id });
  const [open, setOpen] = useState<Id<"attempts"> | null>(null);

  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-medium tracking-tight">Student work</h2>
        <span className="rounded-full bg-panel px-3 py-1 text-sm tabular-nums text-graphite">{rows?.length ?? "…"}</span>
      </div>
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-graphite">
          {detail.assessment.status === "published"
            ? "Nobody has started yet. Work appears here live as students save."
            : "Students can start once you publish it (and the course is published)."}
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line">
            {rows.map((row) => (
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
                    <span className="block truncate font-medium">{row.student}</span>
                    <span className="block text-xs text-graphite">
                      {row.stepsDone >= row.stepsTotal
                        ? "Every step done"
                        : `Step ${row.stepsDone + 1} of ${row.stepsTotal}`}
                      {(row.integrity.tabSwitches ?? 0) > 0 && ` · ${row.integrity.tabSwitches} tab switches`}
                      {row.integrity.pasteBlocked + row.integrity.dropBlocked > 0 &&
                        ` · ${row.integrity.pasteBlocked + row.integrity.dropBlocked} pastes blocked`}
                      {row.autoSubmitted && " · auto-submitted"}
                    </span>
                  </span>
                  {row.status === "submitted" ? (
                    <Pill tone={row.graded ? "ink" : "lime"}>
                      {row.score ?? 0} / {row.maxScore}
                      {row.graded && " ✓"}
                    </Pill>
                  ) : (
                    <Pill>Working</Pill>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-graphite">
            The dot is the integrity colour: advice from the counters, never a verdict. Open a row to read the code,
            leave red-pen notes and grade.
          </p>
        </>
      )}
      {open !== null && (
        <SubmissionReview attemptId={open} title={detail.assessment.title} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
