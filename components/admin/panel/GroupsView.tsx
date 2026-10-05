"use client";

import { useId, useState, type FormEvent } from "react";
import { Card, CardTitle, EmptyNote, PanelHeader, SearchBox } from "@/components/admin/panel/ui";
import { NONE, type AdminUniversity, type GroupRow, type UniversityFilter } from "@/components/admin/types";
import { ArrowButton, ArrowLink, Button } from "@/components/ui/buttons";
import { Field, FormError, SelectInput, TextArea, TextInput } from "@/components/ui/form";
import { Users } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";

export type GroupActions = {
  onCreate: (args: { universityId?: Id<"universities">; name: string; description?: string }) => Promise<string>;
  onArchive: (groupId: GroupRow["_id"], archived: boolean) => Promise<void>;
  onSetLink: (groupId: GroupRow["_id"], enabled: boolean) => Promise<void>;
};

export function GroupsView({
  rows,
  universities,
  filter,
  isSuperAdmin,
  scopeLabel,
  actions,
}: {
  rows: GroupRow[] | undefined;
  universities: AdminUniversity[] | undefined;
  filter: UniversityFilter;
  isSuperAdmin: boolean;
  scopeLabel: string;
  actions: GroupActions;
}) {
  const filterId = useId();
  const [needle, setNeedle] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const query = needle.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (row) => (showArchived || !row.archived) && (query === "" || row.name.toLowerCase().includes(query) || (row.description ?? "").toLowerCase().includes(query)),
  );
  const archivedCount = rows?.filter((row) => row.archived).length ?? 0;

  return (
    <>
      <PanelHeader
        note="Teaching"
        title="Groups"
        description={
          <>
            One group per real class at <span className="font-medium text-ink">{scopeLabel}</span>: admins make them, lecturers join them and
            share their courses with them. Archive a group when the class is over; close its link to stop new students joining.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
        <NewGroupCard universities={universities} filter={filter} isSuperAdmin={isSuperAdmin} onCreate={actions.onCreate} />
        <Card>
          <CardTitle
            count={shown.length}
            aside={
              <>
                {archivedCount > 0 && (
                  <Button size="sm" variant={showArchived ? "ink" : "ghost"} onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "Hiding none" : `${archivedCount} archived`}
                  </Button>
                )}
                <SearchBox id={filterId} label="Filter groups" placeholder="Filter by name" value={needle} onChange={setNeedle} className="w-full sm:w-56" />
              </>
            }
          >
            Groups
          </CardTitle>
          {rows === undefined ? (
            <div className="flex justify-center py-12">
              <WritingDots label="Loading groups" />
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-4">
              <EmptyNote>{rows.length === 0 ? "No groups yet." : "No group matches."}</EmptyNote>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {shown.map((row) => (
                <GroupLine key={row._id} row={row} isSuperAdmin={isSuperAdmin} actions={actions} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function GroupLine({ row, isSuperAdmin, actions }: { row: GroupRow; isSuperAdmin: boolean; actions: GroupActions }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="min-w-0 break-words">{row.name}</span>
            {row.archived && <Pill>Archived</Pill>}
            {!row.archived && !row.inviteEnabled && <Pill>Link closed</Pill>}
            {row.universityId === undefined && <Pill tone="paper">Private</Pill>}
          </p>
          <p className="text-xs text-graphite">
            {[
              isSuperAdmin ? (row.universityName?.en ?? `${row.ownerName}'s own group`) : undefined,
              row.description,
              `${row.members} student${row.members === 1 ? "" : "s"}`,
              row.pendingInvites > 0 ? `${row.pendingInvites} invited` : undefined,
              `${row.lecturers} lecturer${row.lecturers === 1 ? "" : "s"}`,
              `${row.courses} course${row.courses === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!row.archived && (
            <Button size="sm" variant="ghost" disabled={busy === "link"} onClick={() => run("link", () => actions.onSetLink(row._id, !row.inviteEnabled))}>
              {row.inviteEnabled ? "Close link" : "Open link"}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy === "archive"} onClick={() => run("archive", () => actions.onArchive(row._id, !row.archived))}>
            {row.archived ? "Restore" : "Archive"}
          </Button>
          <ArrowLink href={`/groups/${row._id}`}>Open</ArrowLink>
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <FormError>{error}</FormError>
        </div>
      )}
    </li>
  );
}

function NewGroupCard({
  universities,
  filter,
  isSuperAdmin,
  onCreate,
}: {
  universities: AdminUniversity[] | undefined;
  filter: UniversityFilter;
  isSuperAdmin: boolean;
  onCreate: GroupActions["onCreate"];
}) {
  const ids = { university: useId(), name: useId(), note: useId() };
  const [university, setUniversity] = useState<string>(filter === undefined || filter === NONE ? "" : filter);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const active = (universities ?? []).filter((u) => u.status === "active");
  const chosen = university !== "" ? university : !isSuperAdmin && active.length === 1 ? active[0]._id : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen === "") {
      setError("Choose the university this group belongs to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await onCreate({ universityId: chosen as Id<"universities">, name, description: note.trim() || undefined });
      setCreated({ id, name: name.trim() });
      setName("");
      setNote("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-[2rem] bg-card p-6 sm:p-7">
      <span className="grid size-12 place-items-center rounded-full bg-panel">
        <Users className="size-5" />
      </span>
      <div>
        <h2 className="text-2xl font-medium tracking-tight">New group</h2>
        <p className="mt-1 text-sm leading-relaxed text-graphite">One per class. Its lecturers find it under Groups and join it; names are unique at a university.</p>
      </div>
      {(isSuperAdmin || active.length > 1) && (
        <Field label="University" htmlFor={ids.university}>
          <SelectInput id={ids.university} required value={chosen} onChange={(e) => setUniversity(e.target.value)}>
            <option value="" disabled>
              Choose a university…
            </option>
            {active.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name.en}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <Field label="Name" htmlFor={ids.name} hint="Students and lecturers see this.">
        <TextInput id={ids.name} required maxLength={80} placeholder="ICT-24-1" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Note" htmlFor={ids.note} optional hint="Helps lecturers pick the right group.">
        <TextArea id={ids.note} rows={2} maxLength={500} placeholder="Informatics, first year, evening" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <FormError>{error}</FormError>}
      <ArrowButton type="submit" disabled={busy || name.trim() === ""} className="self-start">
        {busy ? "Creating…" : "Create group"}
      </ArrowButton>
      {created && (
        <p className="rounded-2xl bg-highlighter/45 px-4 py-3 text-sm" role="status">
          “{created.name}” is ready.{" "}
          <a href={`/groups/${created.id}`} className="font-medium underline underline-offset-4">
            Open it
          </a>{" "}
          to invite its students.
        </p>
      )}
    </form>
  );
}
