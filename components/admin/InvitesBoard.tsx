"use client";

import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { ArrowButton, Button } from "@/components/ui/buttons";
import { Field, FormError, Segmented, TextInput } from "@/components/ui/form";
import { Check, Copy, Mail } from "@/components/ui/icons";
import { WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

export type Invite = FunctionReturnType<typeof api.invites.listForUniversity>[number];
type InviteRole = Invite["role"];

const DAY = 24 * 60 * 60 * 1000;

const noopSubscribe = () => () => {};
/** The page's origin, without touching `window` during server rendering. */
function useOrigin() {
  return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
}

type Status = "pending" | "accepted" | "expired" | "withdrawn";

function statusOf(invite: Invite, now: number): Status {
  if (invite.revokedAt !== undefined) return "withdrawn";
  if (invite.acceptedAt !== undefined) return "accepted";
  return invite.expiresAt < now ? "expired" : "pending";
}

const statusStyles: Record<Status, string> = {
  pending: "bg-highlighter text-ink",
  accepted: "bg-ok/15 text-ink",
  expired: "bg-panel text-graphite",
  withdrawn: "bg-red-pen/10 text-red-pen",
};

const roleLabel: Record<InviteRole, string> = { lecturer: "Lecturer", uni_admin: "University admin" };

/** Invite form + invite list for one university. */
export function InvitesBoard({
  invites,
  canInviteAdmins,
  onCreate,
  onRevoke,
}: {
  invites: Invite[] | undefined;
  canInviteAdmins: boolean;
  onCreate: (args: { email: string; role: InviteRole }) => Promise<{ token: string }>;
  onRevoke: (inviteId: Invite["_id"]) => Promise<unknown>;
}) {
  const origin = useOrigin();
  const [now] = useState(() => Date.now());
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("lecturer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // The admin page can show one board per university, so ids must be unique.
  const emailId = useId();

  const linkFor = (token: string) => `${origin}/invite/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
    } catch {
      setError(`Couldn't copy automatically. Select and copy this link: ${linkFor(token)}`);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { token } = await onCreate({ email, role });
      setCreated({ email: email.trim().toLowerCase(), token });
      setEmail("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function revoke(inviteId: Invite["_id"]) {
    setError(null);
    try {
      await onRevoke(inviteId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <RevealGroup stagger={0.15} className="grid gap-4 *:min-w-0 lg:grid-cols-[minmax(0,23rem)_1fr]">
      <RevealItem kind="left" className="h-full">
      <form onSubmit={onSubmit} className="flex h-full flex-col gap-5 rounded-[2rem] bg-card p-6 sm:p-7">
        <span className="grid size-12 place-items-center rounded-full bg-panel">
          <Mail className="size-5" />
        </span>
        <div>
          <h3 className="text-2xl font-medium tracking-tight">Invite someone</h3>
          <p className="mt-1 text-sm leading-relaxed text-graphite">
            They get a personal link that only works for their email, for 14 days.
          </p>
        </div>
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
        {canInviteAdmins && (
          <Field
            label="Role"
            hint={
              role === "lecturer"
                ? "Lecturers build their own courses, quizzes and exams."
                : "University admins can see and edit every course here and invite lecturers."
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
          {pending ? "Creating…" : "Create invite link"}
        </ArrowButton>

        <AnimatePresence>
        {created && (
          <motion.div
            key={created.token}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 18 } }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="notch-sides rounded-[1.4rem] bg-charcoal p-4 pl-5 text-paper [--notch-y:50%]"
          >
            <p className="text-xs text-paper/55">Link ready for {created.email}</p>
            <div className="mt-2 flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-paper/85">{linkFor(created.token)}</p>
              <button
                type="button"
                onClick={() => copy(created.token)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-highlighter px-3 py-1.5 text-xs font-semibold text-ink"
              >
                {copied === created.token ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied === created.token ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-3 font-hand text-lg leading-tight text-highlighter">
              Send it yourself for now; invite emails come later.
            </p>
          </motion.div>
        )}
        </AnimatePresence>
      </form>
      </RevealItem>

      <RevealItem kind="right" className="rounded-[2rem] bg-card p-6 sm:p-7">
        <div className="flex items-center gap-3">
          <h3 className="text-2xl font-medium tracking-tight">Invites</h3>
          {invites && (
            <span className="rounded-full bg-panel px-2.5 py-0.5 text-sm tabular-nums text-graphite">
              {invites.length}
            </span>
          )}
        </div>
        {invites === undefined ? (
          <div className="mt-6">
            <WritingDots label="Loading invites" />
          </div>
        ) : invites.length === 0 ? (
          <p className="mt-6 -rotate-1 font-hand text-[1.6rem] text-graphite">No invites yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            <AnimatePresence initial={false}>
            {invites.map((invite) => {
              const status = statusOf(invite, now);
              // Only pending invites the caller can manage come with a token.
              const token = status === "pending" ? invite.token : undefined;
              const daysLeft = Math.max(0, Math.ceil((invite.expiresAt - now) / DAY));
              return (
                <motion.li
                  key={invite._id}
                  layout
                  initial={{ opacity: 0, y: -14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-sm font-semibold uppercase">
                    {invite.email[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invite.email}</p>
                    <p className="text-xs text-graphite">
                      {roleLabel[invite.role]}
                      {status === "pending" && ` · expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[status]}`}>
                    {status}
                  </span>
                  {token !== undefined && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => copy(token)} aria-label={`Copy invite link for ${invite.email}`}>
                        {copied === token ? <Check className="size-4" /> : <Copy className="size-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => revoke(invite._id)}>
                        Withdraw
                      </Button>
                    </div>
                  )}
                </motion.li>
              );
            })}
            </AnimatePresence>
          </ul>
        )}
      </RevealItem>
    </RevealGroup>
  );
}
