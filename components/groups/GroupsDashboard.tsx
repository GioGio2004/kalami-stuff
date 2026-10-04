"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLink, Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { Mail, Plus, Users } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import type { GroupSummary } from "./types";

/**
 * Every group the lecturer runs. A group is a class of students ("CS-101 A",
 * "Saturday tutoring"): students join it by link or email invite, and every
 * course shared with it reaches all of them.
 */
export function GroupsDashboard({
  groups,
  onCreate,
}: {
  groups: GroupSummary[] | undefined;
  onCreate: (args: { name: string; description?: string }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const active = groups?.filter((g) => !g.archived) ?? [];
  const archived = groups?.filter((g) => g.archived) ?? [];

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6 px-1">
        <div>
          <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Your classes</p>
          <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">Groups</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-graphite">
            Make a group for each class you teach, invite the students once, then share courses with the group.
            Everyone in it gets them, including students who join later.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New group
        </Button>
      </div>

      <div className="mt-10">
        {groups === undefined ? (
          <div className="rounded-[2rem] bg-card p-8 text-graphite">Loading your groups…</div>
        ) : active.length === 0 && archived.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
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

      <Dialog open={creating} onClose={() => setCreating(false)} label="New group">
        <NewGroupForm
          onSubmit={async (args) => {
            await onCreate(args);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      </Dialog>
    </div>
  );
}

function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <article className="notch-top flex h-full flex-col rounded-[2rem] bg-card p-6 pt-8">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-panel text-ink">
          <Users className="size-5" />
        </span>
        {group.archived ? <Pill>Archived</Pill> : !group.inviteEnabled && <Pill>Link closed</Pill>}
      </div>
      <h3 className="mt-6 text-2xl font-medium leading-tight tracking-tight">
        <Link href={`/groups/${group._id}`} className="hover:underline hover:underline-offset-4">
          {group.name}
        </Link>
      </h3>
      {group.description && <p className="mt-1.5 line-clamp-2 text-sm text-graphite">{group.description}</p>}
      <p className={`mt-4 text-[15px] ${group.members === 0 ? "font-medium text-red-pen" : "text-ink/80"}`}>
        {group.members === 0
          ? "No students yet: send the invite link"
          : `${group.members} student${group.members === 1 ? "" : "s"}`}
        {group.pendingInvites > 0 && (
          <span className="font-normal text-graphite">
            {" "}
            · <Mail className="inline size-3.5 align-[-2px]" /> {group.pendingInvites} invited
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-graphite">
        {group.courses.length === 0
          ? "No courses shared yet"
          : group.courses.map((c) => c.title).join(" · ")}
      </p>
      <div className="mt-auto flex justify-end pt-6">
        <ArrowLink href={`/groups/${group._id}`}>Open</ArrowLink>
      </div>
    </article>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    { title: "Make a group", text: "One per class: “CS-101 A”, “Saturday tutoring”." },
    { title: "Invite the students", text: "Send the group link anywhere, or paste their emails." },
    { title: "Share your courses", text: "Everyone in the group gets them, now and later." },
  ];
  return (
    <section className="notch-top grid gap-8 rounded-[2rem] bg-card p-6 pt-8 sm:p-8 sm:pt-10 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col">
        <p className="-rotate-2 font-hand text-[1.7rem] leading-none text-graphite">Empty classroom</p>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">No groups yet</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-graphite">
          Groups work anywhere: a university group, a school class, or the students you tutor privately.
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
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; description?: string };
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
            placeholder="CS-101 A"
            maxLength={80}
            autoFocus
            required
          />
        </Field>
        <Field label="Note" htmlFor="group-description" optional hint="Only you see this.">
          <TextArea
            id="group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Mondays and Thursdays, room 204"
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
