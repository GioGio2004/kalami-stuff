"use client";

import { useId } from "react";
import { EMAIL_OFF_LABEL } from "@/components/admin/panel/StudentsView";
import { Avatar, Card, CardTitle, EmptyNote, PanelHeader, SearchBox } from "@/components/admin/panel/ui";
import { ROLE_LABEL, type StaffRow } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Segmented } from "@/components/ui/form";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { timeAgo } from "@/lib/format";

export type StaffRoleFilter = "all" | "lecturer" | "uni_admin" | "super_admin";

/** "Lecturer · Gori State", or "Lecturer · independent". */
export function roleLine(role: StaffRow["roles"][number]): string {
  if (role.role === "super_admin") return ROLE_LABEL.super_admin;
  return `${ROLE_LABEL[role.role]} · ${role.universityName?.en ?? "independent"}`;
}

export function StaffView({
  rows,
  roleFilter,
  onRoleFilter,
  query,
  onQuery,
  searching,
  isSuperAdmin,
  scopeLabel,
  now,
  onOpen,
}: {
  rows: StaffRow[] | undefined;
  roleFilter: StaffRoleFilter;
  onRoleFilter: (filter: StaffRoleFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  searching: boolean;
  isSuperAdmin: boolean;
  scopeLabel: string;
  now: number;
  onOpen: (userId: StaffRow["userId"]) => void;
}) {
  const searchId = useId();
  const options: { value: StaffRoleFilter; label: string }[] = [
    { value: "all", label: "Everyone" },
    { value: "lecturer", label: "Lecturers" },
    { value: "uni_admin", label: "University admins" },
    ...(isSuperAdmin ? [{ value: "super_admin" as const, label: "Platform admins" }] : []),
  ];
  return (
    <>
      <PanelHeader
        note="People"
        title="Lecturers"
        description={
          <>
            Everyone teaching or administering at <span className="font-medium text-ink">{scopeLabel}</span>: their roles, courses,
            groups and when they last changed something. Open one to change their roles.
          </>
        }
      >
        <SearchBox id={searchId} label="Search staff by email" placeholder="Search by email, e.g. nino@" value={query} onChange={onQuery} className="w-full sm:w-72" />
      </PanelHeader>
      <Card>
        <CardTitle
          count={rows?.length}
          aside={!searching && <Segmented label="Role" value={roleFilter} options={options} onChange={onRoleFilter} />}
        >
          {searching ? `Staff whose email starts with “${query.trim()}”` : "Staff"}
        </CardTitle>
        {rows === undefined ? (
          <div className="flex justify-center py-12">
            <WritingDots label="Loading staff" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>{searching ? "Nobody's email starts with that." : "Nobody here yet. Invite lecturers under Invites."}</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <li key={row.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <Avatar name={row.name} email={row.email} src={row.avatarUrl} />
                <div className="min-w-0 flex-1 basis-60">
                  <p className="truncate font-medium">{row.name || "No name yet"}</p>
                  <p className="truncate text-sm text-graphite">{row.email}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {row.roles.map((role) => (
                      <Pill key={role.membershipId} tone={role.role === "super_admin" ? "ink" : role.role === "uni_admin" ? "lime" : "panel"}>
                        {roleLine(role)}
                      </Pill>
                    ))}
                    {row.emailOff && <Pill tone="red">{EMAIL_OFF_LABEL[row.emailOff]}</Pill>}
                  </p>
                </div>
                <dl className="flex shrink-0 gap-5 text-sm tabular-nums">
                  <div className="text-center">
                    <dd className="font-medium">{row.ownedCourses}</dd>
                    <dt className="text-xs text-graphite">courses</dt>
                  </div>
                  <div className="text-center">
                    <dd className="font-medium">{row.groups}</dd>
                    <dt className="text-xs text-graphite">groups</dt>
                  </div>
                  <div className="hidden text-center sm:block">
                    <dd className="font-medium">{row.lastActiveAt === undefined ? "never" : timeAgo(row.lastActiveAt, now)}</dd>
                    <dt className="text-xs text-graphite">last change</dt>
                  </div>
                </dl>
                <Button size="sm" variant="outline" onClick={() => onOpen(row.userId)} aria-label={`Open ${row.name || row.email}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
