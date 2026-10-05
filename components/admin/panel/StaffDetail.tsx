"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ViaPill } from "@/components/admin/panel/OverviewView";
import { roleLine } from "@/components/admin/panel/StaffView";
import { EMAIL_OFF_LABEL } from "@/components/admin/panel/StudentsView";
import { Avatar, EmptyNote, StatTile } from "@/components/admin/panel/ui";
import { ROLE_LABEL, type AdminUniversity, type StaffDetail } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { FormError, Segmented, SelectInput } from "@/components/ui/form";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";

type StaffRole = "lecturer" | "uni_admin";
type RoleLine = StaffDetail["profile"]["roles"][number];
const INDEPENDENT = "independent";

export type StaffActions = {
  onChangeRole: (membershipId: RoleLine["membershipId"], role: StaffRole, universityId: Id<"universities"> | undefined) => Promise<void>;
  onRemoveRole: (membershipId: RoleLine["membershipId"]) => Promise<void>;
  onAddRole: (role: StaffRole, universityId: Id<"universities"> | undefined) => Promise<void>;
};

export function StaffDetailDialog({
  detail,
  open,
  onClose,
  universities,
  isSuperAdmin,
  now,
  actions,
}: {
  detail: StaffDetail | undefined;
  open: boolean;
  onClose: () => void;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  now: number;
  actions: StaffActions;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Staff member" size="lg">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-8">
        {detail === undefined ? (
          <div className="flex justify-center py-16">
            <WritingDots label="Loading" />
          </div>
        ) : (
          <StaffDetailBody detail={detail} universities={universities} isSuperAdmin={isSuperAdmin} now={now} actions={actions} />
        )}
      </div>
    </Dialog>
  );
}

export function StaffDetailBody({
  detail,
  universities,
  isSuperAdmin,
  now,
  actions,
}: {
  detail: StaffDetail;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  now: number;
  actions: StaffActions;
}) {
  const { profile } = detail;
  const [adding, setAdding] = useState(false);
  const students = detail.courses.reduce((sum, course) => sum + course.students, 0);
  const published = detail.courses.reduce((sum, course) => sum + course.assessments.published, 0);
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center gap-4 pr-10">
        <Avatar name={profile.name} email={profile.email} src={profile.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="-rotate-1 font-hand text-[1.3rem] leading-none text-graphite">Staff</p>
          <h2 className="mt-1 text-3xl font-medium tracking-[-0.03em]">{profile.name || "No name yet"}</h2>
          <p className="truncate text-sm text-graphite">
            {profile.email} · joined {formatDate(profile.joinedAt)}
            {profile.lastActiveAt !== undefined ? ` · last change ${timeAgo(profile.lastActiveAt, now)}` : ""}
          </p>
        </div>
        {profile.emailOff && <Pill tone="red">{EMAIL_OFF_LABEL[profile.emailOff]}</Pill>}
      </header>

      <div className="grid gap-2.5 sm:grid-cols-4">
        <StatTile label="Courses owned" value={profile.ownedCourses} note={profile.assistantCourses > 0 ? `+ ${profile.assistantCourses} as assistant` : undefined} tone="ink" />
        <StatTile label="Students reached" value={students} note="Across their courses here" />
        <StatTile label="Published work" value={published} note="Quizzes, tasks, exams" />
        <StatTile label="Groups taught" value={profile.groups} />
      </div>

      <section className="rounded-[1.6rem] bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-medium tracking-tight">Roles</h3>
          {!adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              Add a role
            </Button>
          )}
        </div>
        <ul className="mt-3 space-y-2">
          {profile.roles.map((role) => (
            <RoleRow key={role.membershipId} role={role} universities={universities} isSuperAdmin={isSuperAdmin} actions={actions} />
          ))}
        </ul>
        {adding && (
          <AddRoleForm
            universities={universities}
            isSuperAdmin={isSuperAdmin}
            onCancel={() => setAdding(false)}
            onAdd={async (role, universityId) => {
              await actions.onAddRole(role, universityId);
              setAdding(false);
            }}
          />
        )}
      </section>

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Courses <span className="ml-1 text-base font-normal text-graphite">{detail.courses.length}</span>
        </h3>
        {detail.courses.length === 0 ? (
          <div className="mt-3">
            <EmptyNote>No courses here.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {detail.courses.map((course) => (
              <li key={course._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/courses/${course._id}`} className="truncate underline-offset-4 hover:underline">
                      {course.title}
                    </Link>
                    <Pill tone={statusTone(course.status)}>{statusLabel(course.status)}</Pill>
                    {course.role === "assistant" && <Pill>Assistant</Pill>}
                  </p>
                  <p className="text-xs text-graphite">
                    {course.universityName?.en ?? "No university"} · {course.students} student{course.students === 1 ? "" : "s"} ·{" "}
                    {course.assessments.published} published, {course.assessments.draft} draft · updated {formatDate(course.updatedAt)}
                  </p>
                </div>
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
            <EmptyNote>Teaches no group here.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {detail.groups.map((group) => (
              <li key={group._id}>
                <Link href={`/groups/${group._id}`} className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-2 text-sm hover:bg-panel-strong">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-graphite">
                    {group.universityName?.en ?? "private"} · {group.members} student{group.members === 1 ? "" : "s"}
                  </span>
                  {group.archived && <Pill>Archived</Pill>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSuperAdmin && (
        <section>
          <h3 className="text-lg font-medium tracking-tight">Recent changes</h3>
          {detail.activity.length === 0 ? (
            <div className="mt-3">
              <EmptyNote>Hasn&apos;t changed anything yet.</EmptyNote>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {detail.activity.map((line) => (
                <li key={line._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-graphite" title={formatDateTime(line.at)}>
                    {timeAgo(line.at, now)}
                  </span>
                  <span className="min-w-0 flex-1 basis-60 text-graphite">
                    {line.summary}
                    {line.courseTitle ? ` · ${line.courseTitle}` : ""}
                  </span>
                  <ViaPill via={line.via} client={line.client} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function UniversitySelect({
  id,
  value,
  onChange,
  universities,
  allowIndependent,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  universities: AdminUniversity[] | undefined;
  allowIndependent: boolean;
}) {
  return (
    <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a university…
      </option>
      {(universities ?? [])
        .filter((u) => u.status === "active")
        .map((u) => (
          <option key={u._id} value={u._id}>
            {u.name.en}
          </option>
        ))}
      {allowIndependent && <option value={INDEPENDENT}>No university: independent teacher</option>}
    </SelectInput>
  );
}

function RoleRow({
  role,
  universities,
  isSuperAdmin,
  actions,
}: {
  role: RoleLine;
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  actions: StaffActions;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [nextRole, setNextRole] = useState<StaffRole>(role.role === "uni_admin" ? "uni_admin" : "lecturer");
  const [university, setUniversity] = useState<string>(role.universityId ?? INDEPENDENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  // University admins only change lecturers; role changes to admin and moves between universities are the super admin's.
  const editable = role.role === "lecturer" || role.role === "uni_admin";
  const canChange = isSuperAdmin && editable;
  const canRemove = editable && (isSuperAdmin || role.role === "lecturer");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("view");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={role.role === "super_admin" ? "ink" : role.role === "uni_admin" ? "lime" : "panel"}>{roleLine(role)}</Pill>
        <span className="flex-1" />
        {mode === "view" && canChange && (
          <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
            Change
          </Button>
        )}
        {mode === "view" && canRemove && (
          <Button size="sm" variant="ghost" onClick={() => setMode("remove")}>
            Remove…
          </Button>
        )}
        {!editable && <span className="text-xs text-graphite">Changed from the command line</span>}
      </div>
      {mode === "edit" && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Role"
              value={nextRole}
              options={[
                { value: "lecturer", label: "Lecturer" },
                { value: "uni_admin", label: "University admin" },
              ]}
              onChange={(value) => {
                setNextRole(value);
                if (value === "uni_admin" && university === INDEPENDENT) setUniversity("");
              }}
            />
            <label htmlFor={fieldId} className="sr-only">
              University
            </label>
            <div className="min-w-0 flex-1 basis-56">
              <UniversitySelect id={fieldId} value={university} onChange={setUniversity} universities={universities} allowIndependent={nextRole === "lecturer"} />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-graphite">
            Their courses stay where they were made. Moving away from a university takes them off its groups.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || university === ""}
              onClick={() =>
                run(() => actions.onChangeRole(role.membershipId, nextRole, university === INDEPENDENT ? undefined : (university as Id<"universities">)))
              }
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
      {mode === "remove" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-pen/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 basis-52 text-red-pen">
            Remove this {ROLE_LABEL[role.role].toLowerCase()} role? Without a staff role they can&apos;t use the staff app. Their courses stay.
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
            Keep
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => actions.onRemoveRole(role.membershipId))}>
            {busy ? "Removing…" : "Remove role"}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      )}
    </li>
  );
}

function AddRoleForm({
  universities,
  isSuperAdmin,
  onCancel,
  onAdd,
}: {
  universities: AdminUniversity[] | undefined;
  isSuperAdmin: boolean;
  onCancel: () => void;
  onAdd: (role: StaffRole, universityId: Id<"universities"> | undefined) => Promise<void>;
}) {
  const fieldId = useId();
  const [role, setRole] = useState<StaffRole>("lecturer");
  const [university, setUniversity] = useState<string>(
    !isSuperAdmin && universities?.length === 1 ? universities[0]._id : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
      <p className="text-sm font-medium">New role</p>
      <div className="flex flex-wrap items-center gap-3">
        {isSuperAdmin && (
          <Segmented
            label="Role"
            value={role}
            options={[
              { value: "lecturer", label: "Lecturer" },
              { value: "uni_admin", label: "University admin" },
            ]}
            onChange={(value) => {
              setRole(value);
              if (value === "uni_admin" && university === INDEPENDENT) setUniversity("");
            }}
          />
        )}
        <label htmlFor={fieldId} className="sr-only">
          University
        </label>
        <div className="min-w-0 flex-1 basis-56">
          <UniversitySelect id={fieldId} value={university} onChange={setUniversity} universities={universities} allowIndependent={isSuperAdmin && role === "lecturer"} />
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || university === ""}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onAdd(role, university === INDEPENDENT ? undefined : (university as Id<"universities">));
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add role"}
        </Button>
      </div>
    </div>
  );
}
