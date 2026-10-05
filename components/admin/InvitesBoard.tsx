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
import { formatDate } from "@/lib/format";

export type Invite = FunctionReturnType<typeof api.invites.listForUniversity>[number];
type InviteRole = Invite["role"];
/** What happened to an invitation email: sent, already sent a few minutes ago, or email isn't available. */
export type EmailOutcome = FunctionReturnType<typeof api.invites.resendEmail>;

const DAY = 24 * 60 * 60 * 1000;

const noopSubscribe = () => () => {};
/** The page's origin, without touching `window` during server rendering. */
export function useOrigin() {
  return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
}

export type InviteStatus = "pending" | "accepted" | "expired" | "withdrawn";

export function statusOf(
  invite: { revokedAt?: number; acceptedAt?: number; expiresAt: number },
  now: number,
): InviteStatus {
  if (invite.revokedAt !== undefined) return "withdrawn";
  if (invite.acceptedAt !== undefined) return "accepted";
  return invite.expiresAt < now ? "expired" : "pending";
}

export const statusStyles: Record<InviteStatus, string> = {
  pending: "bg-highlighter text-ink",
  accepted: "bg-ok/15 text-ink",
  expired: "bg-panel text-graphite",
  withdrawn: "bg-red-pen/10 text-red-pen",
};

export const roleLabel: Record<InviteRole, string> = { lecturer: "Lecturer", uni_admin: "University admin" };

const OUTCOME_TEXT: Record<EmailOutcome, string> = {
  sent: "Invitation emailed",
  recent: "Already emailed a few minutes ago, so not sent again",
  off: "Not emailed: email isn't set up on this server, or this address can't receive email. Send the link yourself",
};

/** "Emailed 5 Oct 2026", or that it hasn't been. */
export function emailedLine(invite: { emailedAt?: number }): string {
  return invite.emailedAt === undefined ? "not emailed" : `emailed ${formatDate(invite.emailedAt)}`;
}

/** Shown after creating an invite: whether it was emailed, and the link to copy either way. */
export function CreatedInvite({
  created,
  link,
  copied,
  onCopy,
}: {
  created: { email: string; where?: string; outcome: EmailOutcome };
  link: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const sent = created.outcome === "sent";
  return (
    <div className="notch-sides rounded-[1.4rem] bg-charcoal p-4 pl-5 text-paper [--notch-y:50%]" role="status">
      <p className="flex items-start gap-2 text-sm font-medium">
        {sent ? (
          <Check className="mt-0.5 size-4 shrink-0 text-highlighter" />
        ) : (
          <Mail className="mt-0.5 size-4 shrink-0 text-paper/60" />
        )}
        <span>
          {OUTCOME_TEXT[created.outcome]}
          {sent ? ` to ${created.email}` : ""}
          {created.where ? ` · ${created.where}` : ""}.
        </span>
      </p>
      <div className="mt-3 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-paper/75">{link}</p>
        <button
          type="button"
          onClick={onCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-highlighter px-3 py-1.5 text-xs font-semibold text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

/** Copy, resend and withdraw for an open invite, with what happened on the last resend. */
export function InviteRowActions({
  email,
  token,
  copied,
  onCopy,
  onResend,
  onRevoke,
}: {
  email: string;
  token: string;
  copied: boolean;
  onCopy: (token: string) => void;
  onResend: () => Promise<EmailOutcome>;
  onRevoke: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {message && <span className="mr-1 text-xs text-graphite">{message}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const outcome = await onResend();
            setMessage(outcome === "sent" ? "Sent again" : outcome === "recent" ? "Sent minutes ago" : "Email off: copy the link");
          } catch (caught) {
            setMessage(errorMessage(caught));
          } finally {
            setBusy(false);
          }
        }}
        aria-label={`Email the invitation to ${email} again`}
      >
        <Mail className="size-4" />
        Resend
      </Button>
      <Button size="sm" variant="outline" onClick={() => onCopy(token)} aria-label={`Copy invite link for ${email}`}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={onRevoke}>
        Withdraw
      </Button>
    </div>
  );
}

/** Invite form + invite list for one university. */
export function InvitesBoard({
  invites,
  canInviteAdmins,
  onCreate,
  onResend,
  onRevoke,
}: {
  invites: Invite[] | undefined;
  canInviteAdmins: boolean;
  onCreate: (args: { email: string; role: InviteRole }) => Promise<{ token: string; email: EmailOutcome }>;
  onResend: (inviteId: Invite["_id"]) => Promise<EmailOutcome>;
  onRevoke: (inviteId: Invite["_id"]) => Promise<unknown>;
}) {
  const origin = useOrigin();
  const [now] = useState(() => Date.now());
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("lecturer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; token: string; outcome: EmailOutcome } | null>(null);
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
      const result = await onCreate({ email, role });
      setCreated({ email: email.trim().toLowerCase(), token: result.token, outcome: result.email });
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
            Kalami emails them a personal invitation. The link works only for their email, for 14 days.
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
          {pending ? "Sending…" : "Send invitation"}
        </ArrowButton>

        <AnimatePresence>
        {created && (
          <motion.div
            key={created.token}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 18 } }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <CreatedInvite
              created={created}
              link={linkFor(created.token)}
              copied={copied === created.token}
              onCopy={() => copy(created.token)}
            />
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
              // Only open invites the caller can manage come with a token; expired ones can be resent.
              const token = status === "pending" || status === "expired" ? invite.token : undefined;
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
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-medium">{invite.email}</p>
                    <p className="text-xs text-graphite">
                      {roleLabel[invite.role]}
                      {status === "pending" && ` · expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                      {(status === "pending" || status === "expired") && ` · ${emailedLine(invite)}`}
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
