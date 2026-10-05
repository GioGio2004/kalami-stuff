"use client";

import { useId } from "react";
import { Card, CardTitle, EmptyNote, ListFooter, PanelHeader, SearchBox } from "@/components/admin/panel/ui";
import type { CourseRow, ListStatus } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Segmented } from "@/components/ui/form";
import { Robot } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { formatDate } from "@/lib/format";

export type CourseStatusFilter = "all" | "draft" | "published" | "archived";

export function CoursesView({
  rows,
  status,
  onLoadMore,
  statusFilter,
  onStatusFilter,
  query,
  onQuery,
  searching,
  scopeLabel,
  onOpen,
}: {
  rows: CourseRow[] | undefined;
  status: ListStatus;
  onLoadMore: () => void;
  statusFilter: CourseStatusFilter;
  onStatusFilter: (filter: CourseStatusFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  searching: boolean;
  scopeLabel: string;
  onOpen: (courseId: CourseRow["_id"]) => void;
}) {
  const searchId = useId();
  return (
    <>
      <PanelHeader
        note="Teaching"
        title="Courses"
        description={
          <>
            Every course at <span className="font-medium text-ink">{scopeLabel}</span>, newest first: who owns it, who&apos;s in it and
            what&apos;s published. Open one to change its status, joining, owner, or its quizzes and exams.
          </>
        }
      >
        <SearchBox id={searchId} label="Search courses" placeholder="Title or join code" value={query} onChange={onQuery} className="w-full sm:w-72" />
      </PanelHeader>
      <Card>
        <CardTitle
          count={rows?.length}
          aside={
            !searching && (
              <Segmented
                label="Status"
                value={statusFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "published", label: "Published" },
                  { value: "draft", label: "Draft" },
                  { value: "archived", label: "Archived" },
                ]}
                onChange={onStatusFilter}
              />
            )
          }
        >
          {searching ? `Courses matching “${query.trim()}”` : "Courses"}
        </CardTitle>
        {rows === undefined ? (
          <div className="flex justify-center py-12">
            <WritingDots label="Loading courses" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>{searching ? "No course matches that." : "No courses here yet."}</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <li key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{row.title}</span>
                    <Pill tone={statusTone(row.status)}>{statusLabel(row.status)}</Pill>
                    {!row.joinEnabled && <Pill>Joining off</Pill>}
                    {row.createdVia === "mcp" && (
                      <Pill tone="lime">
                        <Robot className="size-3.5" /> Agent
                      </Pill>
                    )}
                  </p>
                  <p className="truncate text-sm text-graphite">
                    {row.ownerName}
                    {row.ownerEmail ? ` · ${row.ownerEmail}` : ""} · {row.universityName?.en ?? "No university"}
                    {row.semester ? ` · ${row.semester}` : ""}
                  </p>
                  <p className="text-xs text-graphite">
                    Code <span className="font-mono">{row.joinCode}</span> · updated {formatDate(row.updatedAt)}
                  </p>
                </div>
                <dl className="flex shrink-0 gap-5 text-sm tabular-nums">
                  <div className="text-center">
                    <dd className="font-medium">{row.students}</dd>
                    <dt className="text-xs text-graphite">students</dt>
                  </div>
                  <div className="text-center">
                    <dd className="font-medium">{row.assessments.published}</dd>
                    <dt className="text-xs text-graphite">published</dt>
                  </div>
                  <div className="hidden text-center sm:block">
                    <dd className="font-medium">{row.assessments.draft}</dd>
                    <dt className="text-xs text-graphite">drafts</dt>
                  </div>
                </dl>
                <Button size="sm" variant="outline" onClick={() => onOpen(row._id)} aria-label={`Open ${row.title}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!searching && rows !== undefined && rows.length > 0 && (
          <ListFooter shown={rows.length} noun="courses" status={status} onLoadMore={onLoadMore} />
        )}
      </Card>
    </>
  );
}
