"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { EMAIL_OFF_LABEL } from "@/components/admin/panel/StudentsView";
import { Avatar, EmptyNote, StatTile } from "@/components/admin/panel/ui";
import { KIND_LABEL, NONE, type AdminUniversity, type StudentDetail } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/form";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";

export type StudentProfileArgs = {
  universityId: Id<"universities"> | null;
  faculty?: string;
  group?: string;
  year?: number;
  studentNumber?: string;
};

export type StudentActions = {
  onSetEnrollment: (enrollmentId: StudentDetail["enrollments"][number]["_id"], status: "active" | "removed") => Promise<void>;
  onSaveProfile: (args: StudentProfileArgs) => Promise<void>;
};

const INTEGRITY_LABEL = { green: "Clean", yellow: "Some flags", red: "Flagged" } as const;
const INTEGRITY_DOT = { green: "bg-ok", yellow: "bg-warn", red: "bg-red-pen" } as const;

/** One student, in a dialog: profile, stats, courses, groups and every attempt. */
export function StudentDetailDialog({
  detail,
  open,
  onClose,
  universities,
  isSuperAdmin,
  actions,
}: {
  detail: StudentDetail | undefined;
  open: boolean;
  onClose: () => void;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  actions: StudentActions;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Student" size="lg">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-8">
        {detail === undefined ? (
          <div className="flex justify-center py-16">
            <WritingDots label="Loading the student" />
          </div>
        ) : (
          <StudentDetailBody detail={detail} universities={universities} isSuperAdmin={isSuperAdmin} actions={actions} />
        )}
      </div>
    </Dialog>
  );
}

export function StudentDetailBody({
  detail,
  universities,
  isSuperAdmin,
  actions,
}: {
  detail: StudentDetail;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  actions: StudentActions;
}) {
  const { profile, stats } = detail;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center gap-4 pr-10">
        <Avatar name={profile.name} email={profile.email} src={profile.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="-rotate-1 font-hand text-[1.3rem] leading-none text-graphite">Student</p>
          <h2 className="mt-1 text-3xl font-medium tracking-[-0.03em]">{profile.name || "No name yet"}</h2>
          <p className="truncate text-sm text-graphite">
            {profile.email} · joined {formatDate(profile.joinedAt)} · {profile.locale === "ka" ? "Georgian" : "English"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!profile.onboarded && <Pill>Not onboarded</Pill>}
          {profile.emailOff && <Pill tone="red">{EMAIL_OFF_LABEL[profile.emailOff]}</Pill>}
        </div>
      </header>

      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Attempts" value={stats.attempts} />
        <StatTile label="Submitted" value={stats.submitted} note={stats.inProgress > 0 ? `${stats.inProgress} in progress` : undefined} />
        <StatTile label="Average" value={stats.averagePercent === undefined ? "–" : `${stats.averagePercent}%`} tone="ink" />
        <StatTile label="Best" value={stats.bestPercent === undefined ? "–" : `${stats.bestPercent}%`} />
        <StatTile label="To grade" value={stats.needsGrading} note="Essays waiting" />
        <StatTile label="Flagged" value={stats.flagged} tone={stats.flagged > 0 ? "lime" : "card"} note="Integrity turned red" />
      </div>

      <section className="rounded-[1.6rem] bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-medium tracking-tight">Profile</h3>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
          )}
        </div>
        {editing ? (
          <ProfileForm
            detail={detail}
            universities={universities}
            isSuperAdmin={isSuperAdmin}
            onCancel={() => setEditing(false)}
            onSave={async (args) => {
              await actions.onSaveProfile(args);
              setEditing(false);
            }}
          />
        ) : (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-graphite">University</dt>
              <dd className="mt-0.5">{profile.universityName?.en ?? "None"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-graphite">Faculty</dt>
              <dd className="mt-0.5">{profile.faculty ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-graphite">Group · year</dt>
              <dd className="mt-0.5">
                {profile.group ?? "–"}
                {profile.year !== undefined ? ` · year ${profile.year}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-graphite">Student ID</dt>
              <dd className="mt-0.5">{profile.studentNumber ?? "–"}</dd>
            </div>
          </dl>
        )}
      </section>

      {error && <FormError>{error}</FormError>}

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Courses <span className="ml-1 text-base font-normal text-graphite">{detail.enrollments.length}</span>
        </h3>
        {detail.enrollments.length === 0 ? (
          <div className="mt-3">
            <EmptyNote>Not in any course yet.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {detail.enrollments.map((row) => (
              <li key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-52">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/courses/${row.courseId}`} className="truncate underline-offset-4 hover:underline">
                      {row.courseTitle}
                    </Link>
                    <Pill tone={statusTone(row.courseStatus)}>{statusLabel(row.courseStatus)}</Pill>
                    {row.status === "removed" && <Pill tone="red">Removed</Pill>}
                  </p>
                  <p className="text-xs text-graphite">
                    Joined {formatDate(row.enrolledAt)}
                    {row.viaCode ? " with the code" : ""}
                    {row.groupNames.length > 0 ? ` · through ${row.groupNames.join(", ")}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={row.status === "active" ? "ghost" : "outline"}
                  disabled={busy === row._id}
                  onClick={() => run(row._id, () => actions.onSetEnrollment(row._id, row.status === "active" ? "removed" : "active"))}
                >
                  {busy === row._id ? "Saving…" : row.status === "active" ? "Remove from course" : "Let back in"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Groups <span className="ml-1 text-base font-normal text-graphite">{detail.groups.length}</span>
        </h3>
        {detail.groups.length === 0 ? (
          <div className="mt-3">
            <EmptyNote>Not in any group.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {detail.groups.map((group) => (
              <li key={group._id}>
                <Link href={`/groups/${group._id}`} className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-2 text-sm hover:bg-panel-strong">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-graphite">
                    {group.universityName?.en ?? "private"} · joined {formatDate(group.joinedAt)} by {group.via === "link" ? "link" : "email"}
                  </span>
                  {group.archived && <Pill>Archived</Pill>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Attempts <span className="ml-1 text-base font-normal text-graphite">{detail.attempts.length}</span>
        </h3>
        {detail.attempts.length === 0 ? (
          <div className="mt-3">
            <EmptyNote>No quizzes, tasks or exams yet.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {detail.attempts.map((attempt) => (
              <li key={attempt._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
                <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${INTEGRITY_DOT[attempt.integrity]}`} />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/courses/${attempt.courseId}/assessments/${attempt.assessmentId}`} className="truncate underline-offset-4 hover:underline">
                      {attempt.assessmentTitle}
                    </Link>
                    <Pill>{KIND_LABEL[attempt.kind]}</Pill>
                    {attempt.number > 1 && <Pill>Attempt {attempt.number}</Pill>}
                  </p>
                  <p className="text-xs text-graphite">
                    {attempt.courseTitle} · started {formatDateTime(attempt.startedAt)}
                    {attempt.submittedAt !== undefined ? ` · submitted ${formatDateTime(attempt.submittedAt)}` : ""}
                    {attempt.autoSubmitted ? " (by the clock)" : ""} · {INTEGRITY_LABEL[attempt.integrity]}
                  </p>
                </div>
                {attempt.status === "in_progress" ? (
                  <Pill tone="lime">In progress</Pill>
                ) : attempt.needsGrading ? (
                  <Pill tone="paper">Needs grading</Pill>
                ) : (
                  <span className="tabular-nums">
                    <span className="font-medium">
                      {attempt.score ?? "–"}/{attempt.maxScore}
                    </span>
                    {attempt.percent !== undefined && <span className="text-graphite"> · {attempt.percent}%</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProfileForm({
  detail,
  universities,
  isSuperAdmin,
  onCancel,
  onSave,
}: {
  detail: StudentDetail;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  onCancel: () => void;
  onSave: (args: StudentProfileArgs) => Promise<void>;
}) {
  const { profile } = detail;
  const ids = { university: useId(), faculty: useId(), group: useId(), year: useId(), number: useId() };
  const [university, setUniversity] = useState<string>(profile.universityId ?? NONE);
  const [faculty, setFaculty] = useState(profile.faculty ?? "");
  const [group, setGroup] = useState(profile.group ?? "");
  const [year, setYear] = useState(profile.year?.toString() ?? "");
  const [studentNumber, setStudentNumber] = useState(profile.studentNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const none = university === NONE;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(
        none
          ? { universityId: null }
          : {
              universityId: university as Id<"universities">,
              faculty,
              group,
              year: year === "" ? undefined : Number(year),
              studentNumber: studentNumber.trim() === "" ? undefined : studentNumber,
            },
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="University" htmlFor={ids.university}>
          <SelectInput id={ids.university} value={university} onChange={(e) => setUniversity(e.target.value)}>
            {(universities ?? [])
              .filter((u) => u.status === "active" || u._id === profile.universityId)
              .map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name.en}
                </option>
              ))}
            {(isSuperAdmin || profile.universityId === undefined) && <option value={NONE}>No university</option>}
          </SelectInput>
        </Field>
        {!none && (
          <>
            <Field label="Faculty" htmlFor={ids.faculty}>
              <TextInput id={ids.faculty} required maxLength={120} value={faculty} onChange={(e) => setFaculty(e.target.value)} />
            </Field>
            <Field label="Group" htmlFor={ids.group}>
              <TextInput id={ids.group} required maxLength={40} value={group} onChange={(e) => setGroup(e.target.value)} />
            </Field>
            <Field label="Year" htmlFor={ids.year} hint="1 to 8">
              <TextInput id={ids.year} required type="number" min={1} max={8} value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
            <Field label="Student ID" htmlFor={ids.number} optional>
              <TextInput id={ids.number} maxLength={40} value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <p className="text-xs leading-relaxed text-graphite">
        Moving a student to another university doesn&apos;t change their courses or groups; a university&apos;s join codes only accept its own students.
      </p>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
