import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Clock, Code, ListChecks, Robot, Shield } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { formatDateTime } from "@/lib/format";
import { INTEGRITY_LABEL, KIND_LABEL, type Assessment } from "./types";

/**
 * One task, quiz or exam in the course outline: opens the builder. `aside`
 * (a "Move to…" select) sits beside the link on wide screens and drops under
 * it on phones; it's kept outside the link so it stays its own control.
 */
export function AssessmentRow({
  assessment,
  courseId,
  aside,
}: {
  assessment: Assessment;
  courseId: string;
  aside?: ReactNode;
}) {
  const { settings } = assessment;
  return (
    <div className="flex flex-wrap items-center rounded-2xl border border-line bg-paper transition focus-within:border-ink/30 hover:border-ink/30">
      <Link
        href={`/courses/${courseId}/assessments/${assessment._id}`}
        className="flex min-w-0 flex-1 basis-64 items-center gap-4 rounded-2xl px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          {assessment.kind === "task" ? <Code className="size-5" /> : <ListChecks className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words font-medium">{assessment.title}</span>
            <Pill tone={statusTone(assessment.status)}>{statusLabel(assessment.status)}</Pill>
            {assessment.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Agent
              </Pill>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite">
            <span>
              {KIND_LABEL[assessment.kind]} · {assessment.questionCount} question{assessment.questionCount === 1 ? "" : "s"} ·{" "}
              {assessment.totalPoints} pts
            </span>
            <span className="inline-flex items-center gap-1">
              <Shield className="size-3.5" />
              {INTEGRITY_LABEL[settings.integrityLevel]}
            </span>
            {settings.timeLimitMin && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" />
                {settings.timeLimitMin} min
              </span>
            )}
            {settings.opensAt && <span>Opens {formatDateTime(settings.opensAt)}</span>}
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-graphite" />
      </Link>
      {aside && <div className="w-full px-4 pb-3 sm:w-auto sm:py-2 sm:pl-0 sm:pr-3">{aside}</div>}
    </div>
  );
}

/** A compact native select styled as a pill; for "Move to…" pickers inside rows. */
export const compactSelectClass =
  "h-9 max-w-full rounded-full border border-line bg-card pl-3 pr-8 text-sm text-ink outline-none transition hover:border-ink/25 focus:border-ink focus:ring-4 focus:ring-highlighter/60 disabled:opacity-45";
