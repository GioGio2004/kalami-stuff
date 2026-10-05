"use client";

import type { FunctionReturnType } from "convex/server";
import { useId, useState, type FormEvent } from "react";
import { ArrowButton } from "@/components/ui/buttons";
import { Field, FormError, Segmented, SelectInput, TextInput } from "@/components/ui/form";
import { Mail } from "@/components/ui/icons";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import type { AdminUniversity } from "./types";
import {
  CreatedInvite,
  emailedLine,
  InviteRowActions,
  roleLabel,
  statusOf,
  statusStyles,
  useOrigin,
  type EmailOutcome,
} from "./InvitesBoard";

export type AnyInvite = FunctionReturnType<typeof api.invites.listAll>[number];
type InviteRole = AnyInvite["role"];
type UniversityId = AdminUniversity["_id"];

const DAY = 24 * 60 * 60 * 1000;
/** The select's value for "no university": an independent teacher. */
const INDEPENDENT = "independent";
const ALL = "all";

/**
 * The super admin's invites in one place: invite a lecturer (or a university
 * admin) and pick their university as you do; Kalami emails the invitation.
 * Then keep track of every invite, with the university it's for, in one list.
 */
export function InviteCenter({
  universities,
  invites,
  onCreate,
  onResend,
  onRevoke,
}: {
  universities: AdminUniversity[] | undefined;
  invites: AnyInvite[] | undefined;
  onCreate: (args: {
    universityId?: UniversityId;
    email: string;
    role: InviteRole;
  }) => Promise<{ token: string; email: EmailOutcome }>;
  onResend: (inviteId: AnyInvite["_id"]) => Promise<EmailOutcome>;
  onRevoke: (inviteId: AnyInvite["_id"]) => Promise<unknown>;
}) {
  const origin = useOrigin();
  const [now] = useState(() => Date.now());
  const emailId = useId();
  const universityFieldId = useId();
  const filterId = useId();
  const [email, setEmail] = useState("");
  // "" until one is picked, so nobody lands in the wrong university by default.
  const [university, setUniversity] = useState<string>("");
  const [role, setRole] = useState<InviteRole>("lecturer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; where: string; token: string; outcome: EmailOutcome } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(ALL);

  const active = (universities ?? []).filter((u) => u.status === "active");
  const independent = university === INDEPENDENT;
  // University admins need a university; independent teachers are lecturers.
  const shownRole: InviteRole = independent ? "lecturer" : role;
  const linkFor = (token: string) => `${origin}/invite/${token}`;
  const whereLabel = (invite: { universityName?: { en: string } }) => invite.universityName?.en ?? "Independent teacher";

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
    } catch {
      setError(`Couldn't copy automatically. Select and copy this link: ${linkFor(token)}`);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (university === "") {
      setError("Choose the university they teach at, or Independent teacher.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const universityId = independent ? undefined : (university as UniversityId);
      const result = await onCreate({ universityId, email, role: shownRole });
      const where = independent ? "Independent teacher" : (active.find((u) => u._id === university)?.name.en ?? "");
      setCreated({ email: email.trim().toLowerCase(), where, token: result.token, outcome: result.email });
      setEmail("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  async function revoke(inviteId: AnyInvite["_id"]) {
    setError(null);
    try {
      await onRevoke(inviteId);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const shown = (invites ?? []).filter((invite) =>
    filter === ALL ? true : filter === INDEPENDENT ? invite.universityId === undefined : invite.universityId === filter,
  );

  return (
    <div className="grid gap-4 *:min-w-0 lg:grid-cols-[minmax(0,23rem)_1fr]">
      <form onSubmit={submit} className="flex h-full flex-col gap-5 rounded-[2rem] bg-card p-6 sm:p-7">
        <span className="grid size-12 place-items-center rounded-full bg-panel">
          <Mail className="size-5" />
        </span>
        <div>
          <h3 className="text-2xl font-medium tracking-tight">Invite someone</h3>
          <p className="mt-1 text-sm leading-relaxed text-graphite">
            Pick where they teach and Kalami emails them a personal invitation; accepting it puts them in that
            university. The link works only for their email, for 14 days.
          </p>
        </div>
        <Field label="University" htmlFor={universityFieldId}>
          <SelectInput
            id={universityFieldId}
            required
            value={university}
            onChange={(e) => {
              setUniversity(e.target.value);
              setError(null);
            }}
          >
            <option value="" disabled>
              Choose a university…
            </option>
            {active.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name.en}
              </option>
            ))}
            <option value={INDEPENDENT}>No university: independent teacher</option>
          </SelectInput>
        </Field>
        <Field
          label="Email"
          htmlFor={emailId}
          hint="They must sign up with exactly this email and verify it. An existing student account can’t become staff."
        >
          <TextInput
            id={emailId}
            type="email"
            required
            placeholder="lecturer@university.edu.ge"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {!independent && (
          <Field
            label="Role"
            hint={
              shownRole === "lecturer"
                ? "Lecturers build their own courses, quizzes and exams, and join their university's groups."
                : "University admins see and edit every course of their university, invite its lecturers and make its groups."
            }
          >
            <div>
              <Segmented
                label="Role"
                value={role}
                options={[
                  { value: "lecturer", label: "Lecturer" },
                  { value: "uni_admin", label: "University admin" },
                ]}
                onChange={setRole}
              />
            </div>
          </Field>
        )}
        {error && <FormError>{error}</FormError>}
        <ArrowButton type="submit" disabled={pending} className="self-start">
          {pending ? "Sending…" : "Send invitation"}
        </ArrowButton>
        {created && (
          <CreatedInvite
            created={created}
            link={linkFor(created.token)}
            copied={copied === created.token}
            onCopy={() => copy(created.token)}
          />
        )}
      </form>

      <section className="rounded-[2rem] bg-card p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-medium tracking-tight">All invites</h3>
          {invites && (
            <span className="rounded-full bg-panel px-2.5 py-0.5 text-sm tabular-nums text-graphite">{shown.length}</span>
          )}
          <div className="w-full sm:ml-auto sm:w-60">
            <label htmlFor={filterId} className="sr-only">
              Show invites for
            </label>
            <SelectInput id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value={ALL}>Every university</option>
              {(universities ?? []).map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name.en}
                </option>
              ))}
              <option value={INDEPENDENT}>Independent teachers</option>
            </SelectInput>
          </div>
        </div>
        {invites === undefined ? (
          <div className="mt-6">
            <WritingDots label="Loading invites" />
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-6 -rotate-1 font-hand text-[1.6rem] text-graphite">
            {invites.length === 0 ? "No invites yet." : "No invites here yet."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {shown.map((invite) => {
              const status = statusOf(invite, now);
              // Open invites (expired ones too: resending renews them) can be copied, resent and withdrawn.
              const token = status === "pending" || status === "expired" ? invite.token : undefined;
              const daysLeft = Math.max(0, Math.ceil((invite.expiresAt - now) / DAY));
              return (
                <li key={invite._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-sm font-semibold uppercase">
                    {invite.email[0]}
                  </span>
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate font-medium">{invite.email}</p>
                    <p className="text-xs text-graphite">
                      {roleLabel[invite.role]} · {whereLabel(invite)}
                      {status === "pending" && ` · expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                      {token !== undefined && ` · ${emailedLine(invite)}`}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[status]}`}>
                    {status}
                  </span>
                  {token !== undefined && (
                    <InviteRowActions
                      email={invite.email}
                      token={token}
                      copied={copied === token}
                      onCopy={copy}
                      onResend={() => onResend(invite._id)}
                      onRevoke={() => revoke(invite._id)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
