"use client";

import Link from "next/link";
import type { Overview } from "@/components/admin/types";
import { KIND_LABEL } from "@/components/admin/types";

const KIND_PLURAL = { task: "Tasks", quiz: "Quizzes", midterm: "Midterms", final: "Finals" } as const;
import { Card, CardTitle, EmptyNote, formatCount, PanelHeader, StatTile, StatusBar } from "@/components/admin/panel/ui";
import { ArrowLink } from "@/components/ui/buttons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { formatDateTime, timeAgo } from "@/lib/format";

export const STATUS_SEGMENTS = {
  published: "bg-ink",
  draft: "bg-highlighter-deep",
  archived: "bg-graphite/35",
} as const;

export function statusSegments(counts: { draft: number; published: number; archived: number }) {
  return [
    { label: "Published", value: counts.published, className: STATUS_SEGMENTS.published },
    { label: "Draft", value: counts.draft, className: STATUS_SEGMENTS.draft },
    { label: "Archived", value: counts.archived, className: STATUS_SEGMENTS.archived },
  ];
}

/** How a change was made, for activity lines. */
export function ViaPill({ via, client }: { via: "web" | "mcp"; client?: string }) {
  return via === "mcp" ? <Pill tone="lime">Agent{client ? ` · ${client}` : ""}</Pill> : <Pill>Web</Pill>;
}

/** The first page of the admin panel: the numbers, what's live, and the latest changes. */
export function OverviewView({ overview, scopeLabel, now }: { overview: Overview | undefined; scopeLabel: string; now: number }) {
  return (
    <>
      <PanelHeader
        note={overview?.isSuperAdmin === false ? "University admin" : "Platform admin"}
        title="Overview"
        description={
          <>
            <span className="font-medium text-ink">{scopeLabel}</span>: who&apos;s here, what&apos;s published and what&apos;s happening right now.
          </>
        }
      />
      {overview === undefined ? (
        <div className="flex justify-center py-16">
          <WritingDots label="Loading the overview" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Students" value={formatCount(overview.people.students, overview.people.capped)} tone="ink" note="Accounts with a student profile" />
            <StatTile label="Lecturers" value={formatCount(overview.people.lecturers, overview.people.capped)} note="Teaching here" />
            <StatTile label="University admins" value={overview.people.uniAdmins} note={overview.people.superAdmins !== undefined ? `${overview.people.superAdmins} platform admin${overview.people.superAdmins === 1 ? "" : "s"}` : undefined} />
            {overview.isSuperAdmin ? (
              <StatTile
                label="Universities"
                value={overview.universities.filter((u) => u.status === "active").length}
                note={`${overview.universities.filter((u) => u.status === "archived").length} archived`}
              />
            ) : (
              <StatTile label="Groups" value={overview.groups.active} note={`${overview.groups.archived} archived`} />
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card>
              <CardTitle count={overview.courses.total}>Courses</CardTitle>
              <div className="mt-5">
                <StatusBar segments={statusSegments(overview.courses)} empty="No courses yet" />
              </div>
            </Card>
            <Card>
              <CardTitle count={overview.assessments.draft + overview.assessments.published + overview.assessments.archived}>
                Quizzes, tasks and exams
              </CardTitle>
              <div className="mt-5">
                <StatusBar segments={statusSegments(overview.assessments)} empty="Nothing written yet" />
              </div>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {(Object.keys(KIND_PLURAL) as (keyof typeof KIND_PLURAL)[]).map((kind) => (
                  <li key={kind}>
                    <Pill>
                      {KIND_PLURAL[kind]} <span className="font-semibold tabular-nums">{overview.assessments.byKind[kind]}</span>
                    </Pill>
                  </li>
                ))}
              </ul>
              {overview.assessments.approximate && (
                <p className="mt-3 text-xs text-graphite">Counted over the newest 300 courses.</p>
              )}
            </Card>
            <Card className={overview.live.attemptsInProgress > 0 ? "ring-2 ring-highlighter" : ""}>
              <CardTitle>Live now</CardTitle>
              <p className="mt-4 text-4xl font-medium tracking-[-0.04em] tabular-nums">{overview.live.attemptsInProgress}</p>
              <p className="text-sm text-graphite">
                {overview.live.attemptsInProgress === 1 ? "student is" : "students are"} in the middle of a quiz, task or exam
              </p>
              <h3 className="mt-5 text-sm font-medium">Closing within two hours</h3>
              {overview.live.closingSoon.length === 0 ? (
                <p className="mt-1.5 text-sm text-graphite">Nothing closes soon.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {overview.live.closingSoon.map((item) => (
                    <li key={item.assessmentId} className="rounded-2xl bg-panel px-3.5 py-2.5 text-sm">
                      <Link href={`/courses/${item.courseId}/assessments/${item.assessmentId}`} className="font-medium underline-offset-4 hover:underline">
                        {item.title}
                      </Link>
                      <p className="text-xs text-graphite">
                        {KIND_LABEL[item.kind]} · {item.courseTitle} · closes {formatDateTime(item.closesAt)} · {item.inProgress} still working
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.isSuperAdmin && <StatTile label="Groups" value={overview.groups.active} note={`${overview.groups.archived} archived`} />}
            <StatTile label="Pending invites" value={overview.pendingInvites} note="Staff invitations not yet accepted" />
            {overview.openTeamConversations !== undefined && (
              <StatTile
                label="Team inbox"
                value={overview.openTeamConversations}
                tone={overview.openTeamConversations > 0 ? "lime" : "card"}
                note={
                  <Link href="/inbox" className="underline underline-offset-4">
                    Conversations waiting for the Kalami team
                  </Link>
                }
              />
            )}
          </div>

          {overview.isSuperAdmin && (
            <Card>
              <CardTitle aside={<ArrowLink href="/admin/activity">All activity</ArrowLink>}>Latest changes</CardTitle>
              {overview.recent.length === 0 ? (
                <div className="mt-4">
                  <EmptyNote>Nothing has happened yet.</EmptyNote>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {overview.recent.map((line) => (
                    <li key={line._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                      <span className="w-20 shrink-0 text-xs text-graphite" title={formatDateTime(line.at)}>
                        {timeAgo(line.at, now)}
                      </span>
                      <span className="min-w-0 flex-1 basis-60">
                        <span className="font-medium">{line.actorName}</span> <span className="text-graphite">{line.summary}</span>
                        {line.courseTitle && <span className="text-graphite"> · {line.courseTitle}</span>}
                      </span>
                      <ViaPill via={line.via} client={line.client} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
