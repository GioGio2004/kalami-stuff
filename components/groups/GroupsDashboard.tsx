"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { ArrowLink, Button, ButtonLink } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { Check, Mail, Plus, Users } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import type { GroupSearchResult, GroupSummary } from "./types";

export type GroupSearch = {
  query: string;
  onQuery: (query: string) => void;
  /** Undefined while loading. */
  results: GroupSearchResult[] | undefined;
  onJoin: (groupId: GroupSearchResult["_id"]) => Promise<void>;
};

/**
 * The groups a lecturer teaches. A group is a class of students ("ICT-24-1"):
 * at a university, its admins make one per class and the lecturers who teach
 * it find it here and join it; a teacher outside any university makes their
 * own. Every course shared with a group reaches all its students.
 */
export function GroupsDashboard({
  groups,
  mode,
  isAdmin,
  search,
  onCreate,
}: {
  groups: GroupSummary[] | undefined;
  /** See groupsMode. */
  mode: "university" | "independent" | "admin";
  /** A university admin or the super admin: links to the admin page, where groups are made. */
  isAdmin: boolean;
  /** University lecturers: finding and joining their university's groups. */
  search?: GroupSearch;
  /** Independent teachers: making their own groups. */
  onCreate?: (args: { name: string; description?: string }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const active = groups?.filter((g) => !g.archived) ?? [];
  const archived = groups?.filter((g) => g.archived) ?? [];

  const intro =
    mode === "independent"
      ? "Make a group for each class you teach, invite the students once, then share courses with the group. Everyone in it gets them, including students who join later."
      : mode === "university"
        ? "Your university's admins make one group per class, so each class exists once. Find the groups you teach, join them, then share your courses with them."
        : "Groups are made and run on the admin page, one per class. Lecturers find them here and join the ones they teach.";

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6 px-1">
        <div>
          <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Your classes</p>
          <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">Groups</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-graphite">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {isAdmin && (
            <ButtonLink href="/admin" variant="outline">
              Manage groups
            </ButtonLink>
          )}
          {onCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New group
            </Button>
          )}
        </div>
      </div>

      {mode !== "admin" && (
        <section className="mt-10">
          {mode === "university" && (
            <h2 className="px-1 text-xl font-medium tracking-tight">
              My groups
              {groups !== undefined && <span className="ml-2 text-base font-normal text-graphite">{active.length}</span>}
            </h2>
          )}
          <div className={mode === "university" ? "mt-4" : ""}>
            {groups === undefined ? (
              <div className="rounded-[2rem] bg-card p-8 text-graphite">Loading your groups…</div>
            ) : active.length === 0 && archived.length === 0 ? (
              mode === "independent" ? (
                <EmptyState onCreate={() => setCreating(true)} />
              ) : (
                <p className="rounded-[2rem] border-2 border-dashed border-ink/15 px-6 py-8 text-center text-[15px] text-graphite">
                  You don&apos;t teach a group yet. Find yours below and join it.
                </p>
              )
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((group) => (
                  <li key={group._id}>
                    <GroupCard group={group} />
                  </li>
                ))}
              </ul>
            )}
            {archived.length > 0 && (
              <details className="mt-6 px-1">
                <summary className="cursor-pointer text-sm text-graphite">
                  {archived.length} archived group{archived.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {archived.map((group) => (
                    <li key={group._id}>
                      <GroupCard group={group} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}

      {search && <FindGroup search={search} />}

      {mode === "admin" && (
        <section className="mt-10 rounded-[2rem] bg-card p-6 sm:p-8">
          <h2 className="text-2xl font-medium tracking-tight">Groups live on the admin page</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-graphite">
            Each university has its groups there: make them, invite the students, and see which lecturers teach them.
          </p>
          <ButtonLink href="/admin" className="mt-5">
            Open the admin page
          </ButtonLink>
        </section>
      )}

      {onCreate && (
        <Dialog open={creating} onClose={() => setCreating(false)} label="New group">
          <NewGroupForm
            onSubmit={async (args) => {
              await onCreate(args);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Dialog>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: GroupSummary }) {
  const courses = group.courses.length + group.otherCourses;
  return (
    <article className="notch-top flex h-full flex-col rounded-[2rem] bg-card p-6 pt-8">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-panel text-ink">
          <Users className="size-5" />
        </span>
        <span className="flex flex-wrap justify-end gap-1.5">
          {group.archived ? <Pill>Archived</Pill> : !group.inviteEnabled && <Pill>Link closed</Pill>}
          {group.universityName && <Pill tone="panel">{group.universityName.en}</Pill>}
        </span>
      </div>
      <h3 className="mt-6 text-2xl font-medium leading-tight tracking-tight">
        <Link href={`/groups/${group._id}`} className="hover:underline hover:underline-offset-4">
          {group.name}
        </Link>
      </h3>
      {group.description && <p className="mt-1.5 line-clamp-2 text-sm text-graphite">{group.description}</p>}
      <p className={`mt-4 text-[15px] ${group.members === 0 ? "font-medium text-red-pen" : "text-ink/80"}`}>
        {group.members === 0
          ? group.manages
            ? "No students yet: send the invite link"
            : "No students yet"
          : `${group.members} student${group.members === 1 ? "" : "s"}`}
        {group.manages && group.pendingInvites > 0 && (
          <span className="font-normal text-graphite">
            {" "}
            · <Mail className="inline size-3.5 align-[-2px]" /> {group.pendingInvites} invited
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-graphite">
        {group.courses.length > 0
          ? group.courses.map((c) => c.title).join(" · ")
          : courses === 0
            ? "No courses shared yet"
            : "None of your courses yet"}
        {group.otherCourses > 0 && ` · ${group.otherCourses} from other lecturers`}
      </p>
      <div className="mt-auto flex justify-end pt-6">
        <ArrowLink href={`/groups/${group._id}`}>Open</ArrowLink>
      </div>
    </article>
  );
}

/** Search the university's groups by name and join the ones you teach. */
function FindGroup({ search }: { search: GroupSearch }) {
  const inputId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { results, query } = search;
  const typed = query.trim() !== "";

  async function join(groupId: GroupSearchResult["_id"]) {
    setBusy(groupId);
    setError(null);
    try {
      await search.onJoin(groupId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-10 rounded-[2rem] bg-card p-5 sm:p-7">
      <h2 className="text-xl font-medium tracking-tight">Find your group</h2>
      <p className="mt-1 text-sm text-graphite">Your university&apos;s groups. Join the ones you teach.</p>
      <div className="mt-4 max-w-xl">
        <label htmlFor={inputId} className="sr-only">
          Search groups by name
        </label>
        <TextInput
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => search.onQuery(e.target.value)}
          placeholder="Search by name, e.g. ICT-24-1"
          autoComplete="off"
          maxLength={80}
        />
      </div>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-5" aria-live="polite">
        {results === undefined ? (
          <p className="text-sm text-graphite">Searching…</p>
        ) : results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-graphite">
            {typed
              ? `No group matches “${query.trim()}”. Check the spelling, or ask your university admin to add it.`
              : "Your university has no groups yet. Ask your university admin to add them."}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
            {results.map((group) => (
              <li key={group._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="min-w-0 flex-1 basis-52">
                  <span className="block break-words font-medium">{group.name}</span>
                  <span className="block text-xs text-graphite">
                    {[
                      group.description,
                      `${group.members} student${group.members === 1 ? "" : "s"}`,
                      `${group.lecturers} lecturer${group.lecturers === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {group.joined ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-ok">
                      <Check className="size-4" />
                      You teach it
                    </span>
                    <ArrowLink href={`/groups/${group._id}`}>Open</ArrowLink>
                  </span>
                ) : (
                  <Button size="sm" variant="lime" disabled={busy !== null} onClick={() => join(group._id)}>
                    {busy === group._id ? "Joining…" : "Join"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    { title: "Make a group", text: "One per class: “Saturday tutoring”, “Grade 9 B”." },
    { title: "Invite the students", text: "Send the group link anywhere, or paste their emails." },
    { title: "Share your courses", text: "Everyone in the group gets them, now and later." },
  ];
  return (
    <section className="notch-top grid gap-8 rounded-[2rem] bg-card p-6 pt-8 sm:p-8 sm:pt-10 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col">
        <p className="-rotate-2 font-hand text-[1.7rem] leading-none text-graphite">Empty classroom</p>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">No groups yet</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-graphite">
          A school class or the students you tutor privately: only you see and run your groups.
        </p>
        <div className="mt-6">
          <Button onClick={onCreate}>
            <Plus className="size-4" />
            New group
          </Button>
        </div>
      </div>
      <ol className="space-y-4 self-center">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-highlighter text-sm font-semibold text-ink">
              {index + 1}
            </span>
            <span>
              <span className="block font-medium">{step.title}</span>
              <span className="text-sm text-graphite">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function NewGroupForm({
  initial,
  noteHint = "Only you see this.",
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; description?: string };
  /** Who reads the note: only the teacher, or the lecturers looking for a university's group. */
  noteHint?: string;
  onSubmit: (args: { name: string; description?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, description: initial ? description : description || undefined });
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-6 sm:p-10">
      {!initial && <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A new class</p>}
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">{initial ? "Edit group" : "New group"}</h2>
      {!initial && (
        <p className="mt-2 text-[15px] text-graphite">You get an invite link right away. Courses can be shared afterwards.</p>
      )}
      <div className="mt-6 space-y-5">
        <Field label="Name" htmlFor="group-name" hint="Students see this when they join.">
          <TextInput
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ICT-24-1"
            maxLength={80}
            autoFocus
            required
          />
        </Field>
        <Field label="Note" htmlFor="group-description" optional hint={noteHint}>
          <TextArea
            id="group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Informatics, first year, evening"
          />
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {initial ? "Save" : "Create group"}
        </Button>
      </div>
    </form>
  );
}
