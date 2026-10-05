"use client";

import type { FunctionReturnType } from "convex/server";
import { useId, useState } from "react";
import { Button } from "@/components/ui/buttons";
import { FormError, Segmented, SelectInput, TextInput } from "@/components/ui/form";
import { Pill } from "@/components/ui/Pill";
import type { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import type { AdminUniversity } from "./types";

export type Person = FunctionReturnType<typeof api.people.search>[number];
type Membership = Person["memberships"][number];
type StaffRole = "lecturer" | "uni_admin";
type UniversityId = AdminUniversity["_id"];

const INDEPENDENT = "independent";

const ROLE_LABEL: Record<Membership["role"], string> = {
  student: "Student",
  lecturer: "Lecturer",
  uni_admin: "University admin",
  super_admin: "Platform admin",
};

/**
 * The super admin's people search: find someone by the start of their email,
 * see their roles, and change a lecturer or university admin role (role and
 * university) or remove it. Students and the platform admin role aren't
 * changed here.
 */
export function PeoplePanel({
  query,
  onQuery,
  people,
  universities,
  onChange,
  onRemove,
}: {
  query: string;
  onQuery: (query: string) => void;
  /** Undefined while searching. */
  people: Person[] | undefined;
  universities: AdminUniversity[] | undefined;
  onChange: (membershipId: Membership["_id"], role: StaffRole, universityId: UniversityId | undefined) => Promise<void>;
  onRemove: (membershipId: Membership["_id"]) => Promise<void>;
}) {
  const searchId = useId();
  const typed = query.trim().length >= 2;
  return (
    <section className="rounded-[2rem] bg-card p-6 sm:p-7">
      <h3 className="text-2xl font-medium tracking-tight">Find a person</h3>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-graphite">
        Search by email to see someone&apos;s roles. Lecturers and university admins can be switched, moved to another
        university or have their staff access removed; their courses always stay.
      </p>
      <div className="mt-4 max-w-xl">
        <label htmlFor={searchId} className="sr-only">
          Search people by email
        </label>
        <TextInput
          id={searchId}
          type="search"
          autoComplete="off"
          placeholder="Start of an email, e.g. nino@ or nino.beridze"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="mt-5" aria-live="polite">
        {!typed ? (
          <p className="text-sm text-graphite">Type at least two characters of an email.</p>
        ) : people === undefined ? (
          <p className="text-sm text-graphite">Searching…</p>
        ) : people.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-graphite">
            Nobody&apos;s email starts with “{query.trim()}”. They may not have signed up yet: invite them above.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
            {people.map((person) => (
              <PersonRow key={person._id} person={person} universities={universities} onChange={onChange} onRemove={onRemove} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PersonRow({
  person,
  universities,
  onChange,
  onRemove,
}: {
  person: Person;
  universities: AdminUniversity[] | undefined;
  onChange: (membershipId: Membership["_id"], role: StaffRole, universityId: UniversityId | undefined) => Promise<void>;
  onRemove: (membershipId: Membership["_id"]) => Promise<void>;
}) {
  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-sm font-semibold uppercase">
          {(person.name || person.email)[0]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{person.name || "No name yet"}</span>
          <span className="block truncate text-sm text-graphite">{person.email}</span>
        </span>
      </div>
      {person.memberships.length === 0 ? (
        <p className="mt-3 text-sm text-graphite">No role: signed up, but neither a student nor staff.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {person.memberships.map((membership) => (
            <MembershipRow
              key={membership._id}
              membership={membership}
              universities={universities}
              onChange={onChange}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MembershipRow({
  membership,
  universities,
  onChange,
  onRemove,
}: {
  membership: Membership;
  universities: AdminUniversity[] | undefined;
  onChange: (membershipId: Membership["_id"], role: StaffRole, universityId: UniversityId | undefined) => Promise<void>;
  onRemove: (membershipId: Membership["_id"]) => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [role, setRole] = useState<StaffRole>(membership.role === "uni_admin" ? "uni_admin" : "lecturer");
  const [university, setUniversity] = useState<string>(membership.universityId ?? INDEPENDENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const universityFieldId = useId();
  const staff = membership.role === "lecturer" || membership.role === "uni_admin";
  const where = membership.universityName?.en ?? (membership.role === "lecturer" ? "Independent teacher" : undefined);

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
        <Pill tone={membership.role === "student" ? "panel" : "lime"}>{ROLE_LABEL[membership.role]}</Pill>
        {where && <span className="min-w-0 flex-1 truncate text-sm">{where}</span>}
        {!where && <span className="flex-1" />}
        {staff && mode === "view" && (
          <span className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("remove")}>
              Remove…
            </Button>
          </span>
        )}
        {!staff && (
          <span className="text-xs text-graphite">
            {membership.role === "student" ? "Students stay students" : "Changed from the command line"}
          </span>
        )}
      </div>

      {mode === "edit" && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Role"
              value={role}
              options={[
                { value: "lecturer", label: "Lecturer" },
                { value: "uni_admin", label: "University admin" },
              ]}
              onChange={(next) => {
                setRole(next);
                // A university admin always has a university.
                if (next === "uni_admin" && university === INDEPENDENT) setUniversity("");
              }}
            />
            <label htmlFor={universityFieldId} className="sr-only">
              University
            </label>
            <div className="min-w-0 flex-1 basis-56">
              <SelectInput id={universityFieldId} value={university} onChange={(e) => setUniversity(e.target.value)}>
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
                {role === "lecturer" && <option value={INDEPENDENT}>No university: independent teacher</option>}
              </SelectInput>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-graphite">
            Their courses stay where they were made. Moving away from a university takes them off its groups; the courses
            they shared there stay with the students.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || university === ""}
              onClick={() =>
                run(() => onChange(membership._id, role, university === INDEPENDENT ? undefined : (university as UniversityId)))
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
            Remove this {ROLE_LABEL[membership.role].toLowerCase()} role? Without a staff role they can&apos;t use the
            staff app. Their courses stay.
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
            Keep
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => onRemove(membership._id))}>
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
