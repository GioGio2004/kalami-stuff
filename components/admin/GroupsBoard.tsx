"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { ArrowLink, ArrowButton } from "@/components/ui/buttons";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { Users } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { UniversityGroup } from "@/components/groups/types";
import { errorMessage } from "@/lib/errors";

/**
 * A university's groups, on the admin page: one per class, made here so each
 * class exists once. Lecturers find them under Groups and join the ones they
 * teach; opening a group manages its students and lecturers.
 */
export function GroupsBoard({
  groups,
  onCreate,
}: {
  groups: UniversityGroup[] | undefined;
  onCreate: (args: { name: string; description?: string }) => Promise<string>;
}) {
  const nameId = useId();
  const noteId = useId();
  const filterId = useId();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await onCreate({ name, description: note.trim() || undefined });
      setCreated({ id, name: name.trim() });
      setName("");
      setNote("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = (groups ?? []).filter((g) => needle === "" || g.name.toLowerCase().includes(needle));
  const active = groups?.filter((g) => !g.archived).length ?? 0;

  return (
    <div className="grid gap-4 *:min-w-0 lg:grid-cols-[minmax(0,23rem)_1fr]">
      <form onSubmit={submit} className="flex h-full flex-col gap-5 rounded-[2rem] bg-card p-6 sm:p-7">
        <span className="grid size-12 place-items-center rounded-full bg-panel">
          <Users className="size-5" />
        </span>
        <div>
          <h3 className="text-2xl font-medium tracking-tight">New group</h3>
          <p className="mt-1 text-sm leading-relaxed text-graphite">
            One per class. Its lecturers find it under Groups and join it; names are unique at this university.
          </p>
        </div>
        <Field label="Name" htmlFor={nameId} hint="Students and lecturers see this.">
          <TextInput
            id={nameId}
            required
            maxLength={80}
            placeholder="ICT-24-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor={noteId} optional hint="Helps lecturers pick the right group.">
          <TextArea
            id={noteId}
            rows={2}
            maxLength={500}
            placeholder="Informatics, first year, evening"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <ArrowButton type="submit" disabled={busy || name.trim() === ""} className="self-start">
          {busy ? "Creating…" : "Create group"}
        </ArrowButton>
        {created && (
          <p className="rounded-2xl bg-highlighter/45 px-4 py-3 text-sm" role="status">
            “{created.name}” is ready.{" "}
            <Link href={`/groups/${created.id}`} className="font-medium underline underline-offset-4">
              Open it
            </Link>{" "}
            to invite its students.
          </p>
        )}
      </form>

      <section className="rounded-[2rem] bg-card p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-medium tracking-tight">Groups</h3>
          {groups && (
            <span className="rounded-full bg-panel px-2.5 py-0.5 text-sm tabular-nums text-graphite">{active}</span>
          )}
          {groups && groups.length > 6 && (
            <div className="ml-auto w-full sm:w-56">
              <label htmlFor={filterId} className="sr-only">
                Filter groups
              </label>
              <TextInput id={filterId} type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
        </div>
        {groups === undefined ? (
          <div className="mt-6">
            <WritingDots label="Loading groups" />
          </div>
        ) : groups.length === 0 ? (
          <p className="mt-6 -rotate-1 font-hand text-[1.6rem] text-graphite">No groups yet.</p>
        ) : shown.length === 0 ? (
          <p className="mt-6 text-sm text-graphite">No group matches “{filter.trim()}”.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {shown.map((group) => (
              <li key={group._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
                <div className="min-w-0 flex-1 basis-52">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="min-w-0 break-words">{group.name}</span>
                    {group.archived && <Pill>Archived</Pill>}
                    {!group.archived && !group.inviteEnabled && <Pill>Link closed</Pill>}
                  </p>
                  <p className="text-xs text-graphite">
                    {[
                      group.description,
                      `${group.members} student${group.members === 1 ? "" : "s"}`,
                      `${group.lecturers} lecturer${group.lecturers === 1 ? "" : "s"}`,
                      `${group.courses} course${group.courses === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <ArrowLink href={`/groups/${group._id}`}>Open</ArrowLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
