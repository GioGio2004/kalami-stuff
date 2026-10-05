"use client";

import { useId, useState, type FormEvent } from "react";
import { CreateUniversityCard } from "@/components/admin/CreateUniversityCard";
import { Card, EmptyNote, PanelHeader } from "@/components/admin/panel/ui";
import type { UniversityRow } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { errorMessage } from "@/lib/errors";

export type UniversityPatch = { nameKa?: string; nameEn?: string; slug?: string; status?: "active" | "archived" };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function UniversitiesView({
  rows,
  isSuperAdmin,
  onCreate,
  onUpdate,
}: {
  rows: UniversityRow[] | undefined;
  isSuperAdmin: boolean;
  onCreate: (args: { nameKa: string; nameEn: string; slug: string }) => Promise<unknown>;
  onUpdate: (universityId: UniversityRow["_id"], patch: UniversityPatch) => Promise<void>;
}) {
  return (
    <>
      <PanelHeader
        note="Teaching"
        title="Universities"
        description={
          isSuperAdmin
            ? "Every university on Kalami with who and what is in it. Add one, rename it, or archive it when it stops using Kalami: archived universities keep their data but take no new students or staff."
            : "Your university, with who and what is in it."
        }
      />
      <div className={isSuperAdmin ? "grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start" : ""}>
        {isSuperAdmin && <CreateUniversityCard onCreate={onCreate} />}
        <div className="space-y-3">
          {rows === undefined ? (
            <div className="flex justify-center py-12">
              <WritingDots label="Loading universities" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyNote>No universities yet. Add the first one.</EmptyNote>
          ) : (
            rows.map((row) => <UniversityCard key={row._id} row={row} isSuperAdmin={isSuperAdmin} onUpdate={onUpdate} />)
          )}
        </div>
      </div>
    </>
  );
}

function UniversityCard({
  row,
  isSuperAdmin,
  onUpdate,
}: {
  row: UniversityRow;
  isSuperAdmin: boolean;
  onUpdate: (universityId: UniversityRow["_id"], patch: UniversityPatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = row.status === "archived";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const stats: [string, number][] = [
    ["students", row.students],
    ["lecturers", row.lecturers],
    ["admins", row.admins],
    ["courses", row.courses],
    ["published", row.publishedCourses],
    ["groups", row.groups],
    ["invites open", row.pendingInvites],
  ];

  return (
    <Card className={archived ? "opacity-80" : ""}>
      <div className="flex flex-wrap items-center gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-full text-lg font-semibold ${archived ? "bg-panel text-graphite" : "bg-highlighter"}`}>
          {initials(row.name.en)}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex flex-wrap items-center gap-2 text-2xl font-medium tracking-tight">
            {row.name.en}
            <Pill tone={archived ? "panel" : "ink"}>{archived ? "Archived" : "Active"}</Pill>
          </h2>
          <p className="text-sm text-graphite">
            {row.name.ka} · <span className="font-mono">{row.slug}</span>
          </p>
        </div>
        {isSuperAdmin && !editing && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant={archived ? "lime" : "ghost"} disabled={busy} onClick={() => run(() => onUpdate(row._id, { status: archived ? "active" : "archived" }))}>
              {busy ? "Saving…" : archived ? "Restore" : "Archive"}
            </Button>
          </div>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-panel px-3 py-2.5">
            <dd className="text-2xl font-medium tracking-tight tabular-nums">{value}</dd>
            <dt className="text-xs text-graphite">{label}</dt>
          </div>
        ))}
      </dl>
      {editing && (
        <EditForm
          row={row}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            await onUpdate(row._id, patch);
            setEditing(false);
          }}
        />
      )}
      {error && (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      )}
    </Card>
  );
}

function EditForm({
  row,
  onCancel,
  onSave,
}: {
  row: UniversityRow;
  onCancel: () => void;
  onSave: (patch: UniversityPatch) => Promise<void>;
}) {
  const ids = { ka: useId(), en: useId(), slug: useId() };
  const [nameKa, setNameKa] = useState(row.name.ka);
  const [nameEn, setNameEn] = useState(row.name.en);
  const [slug, setSlug] = useState(row.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const patch: UniversityPatch = {};
      if (nameKa !== row.name.ka) patch.nameKa = nameKa;
      if (nameEn !== row.name.en) patch.nameEn = nameEn;
      if (slug !== row.slug) patch.slug = slug;
      await onSave(patch);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 rounded-2xl border border-line p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name in Georgian" htmlFor={ids.ka}>
          <TextInput id={ids.ka} required maxLength={120} value={nameKa} onChange={(e) => setNameKa(e.target.value)} />
        </Field>
        <Field label="Name in English" htmlFor={ids.en}>
          <TextInput id={ids.en} required maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="Short name" htmlFor={ids.slug} hint="Changing it changes the university's links.">
          <TextInput id={ids.slug} required maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" />
        </Field>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
