"use client";

import Link from "next/link";
import { useId } from "react";
import { ViaPill } from "@/components/admin/panel/OverviewView";
import { Card, CardTitle, EmptyNote, ListFooter, PanelHeader } from "@/components/admin/panel/ui";
import type { AuditLine, ListStatus } from "@/components/admin/types";
import { SelectInput } from "@/components/ui/form";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { formatDateTime, timeAgo } from "@/lib/format";

/** The kinds of record the log can be narrowed to, by the table they live in. */
export const ACTIVITY_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "courses", label: "Courses" },
  { value: "assessments", label: "Quizzes, tasks and exams" },
  { value: "questions", label: "Questions" },
  { value: "weeks", label: "Weeks" },
  { value: "lessons", label: "Lessons" },
  { value: "presentations", label: "Presentations" },
  { value: "groups", label: "Groups" },
  { value: "enrollments", label: "Enrollments" },
  { value: "users", label: "People and roles" },
  { value: "memberships", label: "Student profiles" },
  { value: "universities", label: "Universities" },
  { value: "attempts", label: "Grading" },
  { value: "emailSuppressions", label: "Email" },
];

const TABLE_LABEL: Record<string, string> = Object.fromEntries(ACTIVITY_FILTERS.filter((f) => f.value !== "").map((f) => [f.value, f.label]));

export function ActivityView({
  rows,
  status,
  onLoadMore,
  filter,
  onFilter,
  now,
}: {
  rows: AuditLine[] | undefined;
  status: ListStatus;
  onLoadMore: () => void;
  /** A table name, or "" for everything. */
  filter: string;
  onFilter: (filter: string) => void;
  now: number;
}) {
  const filterId = useId();
  return (
    <>
      <PanelHeader
        note="Platform"
        title="Activity"
        description="Every change anyone made, newest first: in the studio, from the admin panel, or through an AI agent connected to Kalami."
      >
        <div className="w-full sm:w-64">
          <label htmlFor={filterId} className="sr-only">
            Show changes to
          </label>
          <SelectInput id={filterId} value={filter} onChange={(e) => onFilter(e.target.value)}>
            {ACTIVITY_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>
      </PanelHeader>
      <Card>
        <CardTitle count={rows?.length}>Changes</CardTitle>
        {rows === undefined ? (
          <div className="flex justify-center py-12">
            <WritingDots label="Loading activity" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>Nothing recorded yet.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((line) => (
              <li key={line._id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-3 text-sm">
                <time dateTime={new Date(line.at).toISOString()} className="w-24 shrink-0 pt-0.5 text-xs text-graphite" title={formatDateTime(line.at)}>
                  {timeAgo(line.at, now)}
                </time>
                <div className="min-w-0 flex-1 basis-64">
                  <p>
                    <span className="font-medium">{line.actorName}</span>
                    {line.actorEmail && <span className="text-graphite"> · {line.actorEmail}</span>}
                  </p>
                  <p className="text-graphite">
                    {line.summary}
                    {line.courseId && line.courseTitle && (
                      <>
                        {" · "}
                        <Link href={`/courses/${line.courseId}`} className="underline-offset-4 hover:underline">
                          {line.courseTitle}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Pill tone="paper">{TABLE_LABEL[line.targetTable] ?? line.targetTable}</Pill>
                  <ViaPill via={line.via} client={line.client} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows !== undefined && rows.length > 0 && <ListFooter shown={rows.length} noun="changes" status={status} onLoadMore={onLoadMore} />}
      </Card>
    </>
  );
}
