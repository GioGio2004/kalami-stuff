"use client";

import { useId } from "react";
import type { ListStatus, StudentRow } from "@/components/admin/types";
import { Avatar, Card, CardTitle, EmptyNote, ListFooter, PanelHeader, SearchBox } from "@/components/admin/panel/ui";
import { Button } from "@/components/ui/buttons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { formatDate } from "@/lib/format";

export const EMAIL_OFF_LABEL = { opted_out: "Emails off", bounced: "Email bounced", complained: "Marked as spam" } as const;

/** One line about where a student is: university · faculty · group · year. */
export function studentPlace(row: StudentRow): string {
  if (row.universityName === undefined) return "No university";
  return [row.universityName.en, row.faculty, row.group, row.year !== undefined ? `year ${row.year}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

export function StudentsView({
  rows,
  status,
  onLoadMore,
  query,
  onQuery,
  searching,
  scopeLabel,
  onOpen,
}: {
  rows: StudentRow[] | undefined;
  status: ListStatus;
  onLoadMore: () => void;
  query: string;
  onQuery: (query: string) => void;
  /** The list shows email-search results instead of the page-by-page list. */
  searching: boolean;
  scopeLabel: string;
  onOpen: (userId: StudentRow["userId"]) => void;
}) {
  const searchId = useId();
  return (
    <>
      <PanelHeader
        note="People"
        title="Students"
        description={
          <>
            Everyone with a student profile at <span className="font-medium text-ink">{scopeLabel}</span>, newest accounts first.
            Open one to see their courses, groups and every attempt.
          </>
        }
      >
        <SearchBox id={searchId} label="Search students by email" placeholder="Search by email, e.g. ana@" value={query} onChange={onQuery} className="w-full sm:w-72" />
      </PanelHeader>
      <Card>
        <CardTitle count={rows?.length}>{searching ? `Students whose email starts with “${query.trim()}”` : "Students"}</CardTitle>
        {rows === undefined ? (
          <div className="flex justify-center py-12">
            <WritingDots label="Loading students" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>{searching ? "Nobody's email starts with that." : "No students here yet."}</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <li key={row.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <Avatar name={row.name} email={row.email} src={row.avatarUrl} />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{row.name || "No name yet"}</span>
                    {!row.onboarded && <Pill>Not onboarded</Pill>}
                    {row.emailOff && <Pill tone="red">{EMAIL_OFF_LABEL[row.emailOff]}</Pill>}
                  </p>
                  <p className="truncate text-sm text-graphite">{row.email}</p>
                  <p className="truncate text-xs text-graphite">{studentPlace(row)}</p>
                </div>
                <dl className="flex shrink-0 gap-5 text-sm tabular-nums">
                  <div className="text-center">
                    <dd className="font-medium">{row.courses}</dd>
                    <dt className="text-xs text-graphite">courses</dt>
                  </div>
                  <div className="text-center">
                    <dd className="font-medium">{row.groups}</dd>
                    <dt className="text-xs text-graphite">groups</dt>
                  </div>
                  <div className="hidden text-center sm:block">
                    <dd className="font-medium">{formatDate(row.joinedAt)}</dd>
                    <dt className="text-xs text-graphite">joined</dt>
                  </div>
                </dl>
                <Button size="sm" variant="outline" onClick={() => onOpen(row.userId)} aria-label={`Open ${row.name || row.email}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!searching && rows !== undefined && rows.length > 0 && (
          <ListFooter shown={rows.length} noun="students" status={status} onLoadMore={onLoadMore} />
        )}
      </Card>
    </>
  );
}
