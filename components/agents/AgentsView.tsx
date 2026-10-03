"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { Check, Lock, Robot, Shield } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { formatDate, timeAgo } from "@/lib/format";
import { useOrigin } from "@/lib/useOrigin";
import type { TokenRow } from "@/components/studio/types";
import { ConnectSnippets, secretLink } from "./ConnectSnippets";

const EXAMPLE_PROMPTS = [
  "List my courses and tell me which ones have no final yet.",
  "Draft a 10-question quiz on CSS selectors for “Web basics”, in Georgian.",
  "Create a midterm for “Web basics” with 20 questions covering weeks 1 to 6.",
  "Review the questions in my midterm and fix any that are ambiguous.",
];

/** Personal access tokens plus the recipe for each MCP client. */
export function AgentsView({
  tokens,
  onCreateToken,
  onRevokeToken,
}: {
  tokens: TokenRow[] | undefined;
  onCreateToken: (name: string) => Promise<string>;
  onRevokeToken: (tokenId: TokenRow["_id"]) => Promise<void>;
}) {
  const origin = useOrigin();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await onCreateToken(name);
      setFresh({ name, token });
      setName("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const active = tokens?.filter((t) => t.revokedAt === undefined) ?? [];
  const revoked = tokens?.filter((t) => t.revokedAt !== undefined) ?? [];

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="max-w-3xl px-1">
        <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Your assistant, your rules</p>
        <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">Connect an agent</h1>
        <p className="mt-5 text-lg leading-relaxed text-graphite">
          Kalami is an MCP server. Give your own AI agent a personal token and it can draft courses, quizzes and exams
          as you. It can’t publish, and it never sees students.
        </p>
      </div>

      <div className="mt-10 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <section className="notch-top rounded-[2rem] bg-card p-6 pt-8 sm:p-8 sm:pt-10 lg:col-span-7">
          <StepHeading n={1} title="Create a token" />
          <p className="mt-2 text-[15px] leading-relaxed text-graphite">
            A token is a private key that lets one agent act as you. Make one per agent or device, so you can switch
            one off without touching the others.
          </p>
          <form onSubmit={create} className="mt-5 flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field label="Name" htmlFor="token-name">
                <TextInput
                  id="token-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Claude Code on my laptop"
                  maxLength={60}
                  required
                />
              </Field>
            </div>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              Create token
            </Button>
          </form>
          <p className="mt-2 text-xs leading-relaxed text-graphite">The name is only for you, so you know which agent it belongs to.</p>
          {error && (
            <div className="mt-3">
              <FormError>{error}</FormError>
            </div>
          )}

          {fresh && (
            <div className="notch-sides mt-5 rounded-[1.6rem] bg-ink p-5 text-paper [--notch-y:50%]">
              <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-highlighter">
                <Lock className="size-3.5" />
                Shown once
              </p>
              <p className="mt-2 break-all font-mono text-[15px] leading-relaxed">{fresh.token}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <CopyButton value={fresh.token} variant="lime" label="Copy token" />
                <CopyButton value={secretLink(origin, fresh.token)} variant="lime" label="Copy link" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-paper/65">
                “{fresh.name}”. Copy it now; Kalami only keeps a fingerprint and can’t show it again. Step 2 below
                already has it filled in. Use the token for apps with settings files, the link for claude.ai and
                ChatGPT.
              </p>
            </div>
          )}

          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-graphite">Your tokens</h3>
            {tokens === undefined ? (
              <p className="mt-3 text-sm text-graphite">Loading…</p>
            ) : active.length === 0 && revoked.length === 0 ? (
              <p className="mt-3 text-sm text-graphite">No tokens yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {[...active, ...revoked].map((token) => {
                  const dead = token.revokedAt !== undefined;
                  return (
                    <li key={token._id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ${dead ? "bg-panel/60 text-graphite" : "bg-paper"}`}>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-panel">
                        <Robot className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`truncate font-medium ${dead ? "line-through" : ""}`}>{token.name}</span>
                          <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs">{token.prefix}…</code>
                          {dead && <Pill tone="red">Revoked</Pill>}
                        </span>
                        <span className="block text-xs text-graphite">
                          Created {formatDate(token._creationTime)}
                          {token.lastUsedAt ? ` · last used ${timeAgo(token.lastUsedAt)}` : " · never used"}
                        </span>
                      </span>
                      {!dead && <RevokeButton onRevoke={() => onRevokeToken(token._id)} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] bg-charcoal p-6 text-paper sm:p-8 lg:col-span-5">
          <span className="grid size-12 place-items-center rounded-full bg-charcoal-soft text-paper">
            <Shield className="size-5" />
          </span>
          <h2 className="mt-8 text-2xl font-medium tracking-tight">What an agent can and can’t do</h2>
          <ul className="mt-5 space-y-3 text-[15px]">
            {[
              ["Can", "list and create courses, quizzes, midterms and finals you own"],
              ["Can", "add, edit, delete and reorder questions in drafts, with answer keys"],
              ["Can’t", "publish, archive or delete an assessment"],
              ["Can’t", "change an assessment once it’s published"],
              ["Can’t", "see students, attempts, grades or integrity flags"],
              ["Can’t", "touch courses you only assist on"],
            ].map(([verb, what]) => (
              <li key={what} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${verb === "Can" ? "bg-highlighter text-ink" : "bg-paper/15 text-paper"}`}>
                  {verb}
                </span>
                <span className="text-paper/80">{what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-paper/55">
            “Assist on” means a course someone else owns where you were added as a helper; agents only work on courses
            you can edit. Every change an agent makes is written to the course history with a robot icon. Revoking a
            token stops it on the next call.
          </p>
        </section>

        <section className="rounded-[2rem] bg-card p-6 sm:p-8 lg:col-span-7">
          <StepHeading n={2} title="Add Kalami to your agent" />
          <p className="mt-2 text-[15px] leading-relaxed text-graphite">
            Pick the AI app you use and follow its steps. The snippet already contains your new token if you just made
            one.
          </p>
          <div className="mt-5">
            <ConnectSnippets origin={origin} token={fresh?.token} />
          </div>
        </section>

        <section className="rounded-[2rem] bg-highlighter p-6 sm:p-8 lg:col-span-5">
          <StepHeading n={3} title="Ask for a draft" dark />
          <p className="mt-2 text-[15px] leading-relaxed text-ink/75">
            Your agent will call <code className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-xs">whoami</code> first,
            then work through your courses. Try:
          </p>
          <ul className="mt-4 space-y-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt} className="flex items-start gap-2.5 rounded-2xl bg-paper/70 px-4 py-2.5 text-sm leading-snug">
                <Check className="mt-0.5 size-4 shrink-0" />
                {prompt}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-ink/75">
            Everything it makes is a draft. When it’s done it gives you a link: open it, check the questions and
            answer keys, then press Publish yourself.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Revoking is permanent, so it takes a second click. */
function RevokeButton({ onRevoke }: { onRevoke: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
        Revoke
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-graphite">{error ?? "The agent loses access for good."}</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onRevoke();
          } catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
          }
        }}
      >
        Yes, revoke
      </Button>
    </span>
  );
}

function StepHeading({ n, title, dark = false }: { n: number; title: string; dark?: boolean }) {
  return (
    <h2 className="flex items-center gap-3 text-2xl font-medium tracking-tight">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${dark ? "bg-ink text-highlighter" : "bg-highlighter text-ink"}`}>
        {n}
      </span>
      {title}
    </h2>
  );
}
