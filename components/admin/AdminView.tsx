"use client";

import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent, type ReactNode } from "react";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { Enter, Reveal } from "@/components/motion/Reveal";
import { ArrowButton } from "@/components/ui/buttons";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { Building } from "@/components/ui/icons";
import { WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

export type AdminUniversity = FunctionReturnType<typeof api.universities.listAdministered>[number];

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function AdminView({
  isSuperAdmin,
  universities,
  onCreateUniversity,
  renderInvites,
  renderGroups,
  invites,
  people,
  independent,
}: {
  isSuperAdmin: boolean;
  universities: AdminUniversity[] | undefined;
  onCreateUniversity: (args: { nameKa: string; nameEn: string; slug: string }) => Promise<unknown>;
  /** A university admin's invites, inside each university. */
  renderInvites?: (university: AdminUniversity) => ReactNode;
  /** The super admin's invites for every university in one place (InviteCenter), above the universities. */
  invites?: ReactNode;
  /** The super admin's people search and role changes (PeoplePanel), under the invites. */
  people?: ReactNode;
  /** The university's groups: admins make them, lecturers join them. */
  renderGroups?: (university: AdminUniversity) => ReactNode;
  /** Super admin: invites for teachers outside any university (schools, private lessons). */
  independent?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Enter as="section" kind="scale" className="grid gap-8 rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:grid-cols-[1fr_minmax(0,30rem)] lg:items-end lg:px-12">
        <div className="px-1">
          <Enter as="p" kind="left" delay={0.15} className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">
            {isSuperAdmin ? "Platform admin" : "University admin"}
          </Enter>
          <AnimatedHeading
            as="h1"
            delay={0.25}
            className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl"
          >
            Universities &amp; people
          </AnimatedHeading>
          <Enter as="p" delay={0.6} className="mt-5 max-w-md text-lg leading-relaxed text-graphite">
            {isSuperAdmin
              ? "Add universities, appoint their admins, invite lecturers and make each university's groups."
              : "Invite the lecturers of your university and make its groups, one per class."}
          </Enter>
          {universities && (
            <div className="mt-7 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-card px-4 py-2">
                {universities.length} universit{universities.length === 1 ? "y" : "ies"}
              </span>
              {isSuperAdmin && (
                <span className="rounded-full bg-ink px-4 py-2 font-medium text-highlighter">Super admin</span>
              )}
            </div>
          )}
        </div>
        {isSuperAdmin && (
          <Enter kind="right" delay={0.35}>
            <CreateUniversityCard onCreate={onCreateUniversity} />
          </Enter>
        )}
      </Enter>

      {invites && (
        <section className="rounded-[2.5rem] bg-panel p-3 sm:p-6 lg:p-8">
          <header className="flex flex-wrap items-center gap-4 px-2 pb-6 pt-2">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-ink text-highlighter">
              <Building className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-medium tracking-tight">Invites</h2>
              <p className="text-sm text-graphite">
                Lecturers and university admins for every university, and independent teachers: invite them and keep
                track here.
              </p>
            </div>
          </header>
          {invites}
        </section>
      )}

      {people && (
        <section className="rounded-[2.5rem] bg-panel p-3 sm:p-6 lg:p-8">
          <header className="flex flex-wrap items-center gap-4 px-2 pb-6 pt-2">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-highlighter text-lg font-semibold">
              @
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-medium tracking-tight">People</h2>
              <p className="text-sm text-graphite">Find anyone by email, see their roles and change a staff role.</p>
            </div>
          </header>
          {people}
        </section>
      )}

      {independent && (
        <Reveal as="section" kind="up" amount={0.1} className="rounded-[2.5rem] bg-panel p-3 sm:p-6 lg:p-8">
          <header className="flex flex-wrap items-center gap-4 px-2 pb-6 pt-2">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-ink text-lg font-semibold text-highlighter">
              ✎
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-medium tracking-tight">Independent teachers</h2>
              <p className="text-sm text-graphite">
                School teachers and private tutors: no university. They make their own groups and courses.
              </p>
            </div>
          </header>
          {independent}
        </Reveal>
      )}

      {universities === undefined ? (
        <div className="flex justify-center py-16">
          <WritingDots label="Loading universities" />
        </div>
      ) : universities.length === 0 ? (
        <Reveal kind="scale" className="rounded-[2.5rem] border-2 border-dashed border-line px-8 py-16 text-center">
          <p className="font-hand text-[1.8rem] text-graphite">No universities yet.</p>
          <p className="mt-2 text-graphite">Add the first one above; invites live inside it.</p>
        </Reveal>
      ) : (
        universities.map((university) => (
          <Reveal as="section" kind="up" amount={0.1} key={university._id} className="rounded-[2.5rem] bg-panel p-3 sm:p-6 lg:p-8">
            <header className="flex flex-wrap items-center gap-4 px-2 pb-6 pt-2">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-highlighter text-lg font-semibold">
                {initials(university.name.en)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-medium tracking-tight">{university.name.en}</h2>
                <p className="text-sm text-graphite">{university.name.ka}</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-card px-3 py-1.5 font-mono">{university.slug}</span>
                <span
                  className={`rounded-full px-3 py-1.5 font-semibold capitalize ${
                    university.status === "active" ? "bg-ink text-highlighter" : "bg-card text-graphite"
                  }`}
                >
                  {university.status}
                </span>
              </div>
            </header>
            {renderInvites?.(university)}
            {renderGroups && <div className={renderInvites ? "mt-4" : ""}>{renderGroups(university)}</div>}
          </Reveal>
        ))
      )}
    </div>
  );
}

function CreateUniversityCard({
  onCreate,
}: {
  onCreate: (args: { nameKa: string; nameEn: string; slug: string }) => Promise<unknown>;
}) {
  const [nameKa, setNameKa] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownSlug = slugEdited ? slug : slugify(nameEn);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onCreate({ nameKa, nameEn, slug: shownSlug });
      setNameKa("");
      setNameEn("");
      setSlug("");
      setSlugEdited(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[2rem] bg-card p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-panel">
          <Building className="size-5" />
        </span>
        <h2 className="text-xl font-medium tracking-tight">Add a university</h2>
      </div>
      <Field label="Name in Georgian" htmlFor="uni-ka">
        <TextInput
          id="uni-ka"
          required
          placeholder="გორის სახელმწიფო უნივერსიტეტი"
          value={nameKa}
          onChange={(e) => setNameKa(e.target.value)}
        />
      </Field>
      <Field label="Name in English" htmlFor="uni-en">
        <TextInput
          id="uni-en"
          required
          placeholder="Gori State University"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </Field>
      <Field label="Short name" htmlFor="uni-slug" hint="Lowercase letters, digits and dashes. Used in links.">
        <TextInput
          id="uni-slug"
          required
          placeholder="gori-state"
          value={shownSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
          className="font-mono"
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <ArrowButton type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add university"}
      </ArrowButton>
    </form>
  );
}
