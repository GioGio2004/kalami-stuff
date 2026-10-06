"use client";

import { useState } from "react";
import type { PresentationDetail } from "@/components/studio/types";
import { Button, buttonClass } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { CheckCard, FormError } from "@/components/ui/form";
import { ArrowUpRight } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { presentationShareUrl } from "@/lib/urls";
import { DeckCover } from "./DeckCover";

/**
 * Sharing a presentation by link: anyone who has it watches the deck in
 * Kalami's player, no account needed (in a class chat, an email, a post).
 * The link shows the saved slides and nothing else of the course; speaker
 * notes only if the lecturer adds them. A new link retires the old one at
 * once, and so does Stop sharing. Assistants see the link to copy it; only
 * the course's owner (or an admin) changes it.
 */
export function SharePresentation({
  deck,
  dirty,
  onShare,
  onStop,
  onClose,
}: {
  deck: PresentationDetail;
  /** The editor has unsaved changes (the link shows the saved version). */
  dirty: boolean;
  onShare: (options: { notes: boolean; newLink?: boolean }) => Promise<void>;
  onStop: () => Promise<void>;
  onClose: () => void;
}) {
  const share = deck.share;
  const [notes, setNotes] = useState(share?.notes ?? false);
  const [confirm, setConfirm] = useState<"renew" | "stop" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasNotes = deck.slides.some((slide) => slide.notes);
  const students = deck.status === "published" && deck.weekStatus === "published";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const notesOption = deck.canShare && (
    <CheckCard
      checked={notes}
      onChange={(next) => {
        setNotes(next);
        // With a link on, the choice applies straight away (and springs back if it fails); otherwise when the link is made.
        if (share) {
          void run(() =>
            onShare({ notes: next }).catch((caught: unknown) => {
              setNotes(!next);
              throw caught;
            }),
          );
        }
      }}
    >
      <span className="block font-medium">Show my speaker notes</span>
      <span className="mt-0.5 block text-sm text-graphite">
        {hasNotes
          ? "Viewers can open the notes under each slide. Leave this off if they're just for you."
          : "No slide has notes yet. If you add some, viewers can open them under each slide."}
      </span>
    </CheckCard>
  );

  return (
    <div className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">Pass it around</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">Share this presentation</h2>

      {share === null ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-graphite">
            {deck.canShare
              ? "Make a link anyone can watch it with: in a class chat, an email, a post. No Kalami account needed. They see the slides as you last saved them, and nothing else of the course."
              : "It has no link yet. Only the course's owner can make one."}
          </p>
          {deck.canShare && (
            <>
              <div className="mt-6">{notesOption}</div>
              {!students && (
                <p className="mt-4 text-sm leading-relaxed text-graphite">
                  Students in the course don&apos;t see it yet ({deck.status === "draft" ? "it's a draft" : "its week is a draft"}). Anyone
                  with the link will.
                </p>
              )}
            </>
          )}
          {error && (
            <div className="mt-4">
              <FormError>{error}</FormError>
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {deck.canShare ? "Cancel" : "Close"}
            </Button>
            {deck.canShare && (
              <Button variant="lime" disabled={busy} onClick={() => void run(() => onShare({ notes }))}>
                {busy ? "Making the link…" : "Create link"}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <LinkCard deck={deck} url={presentationShareUrl(share.token)} />
          <p className="mt-3 px-1 text-xs text-graphite">
            Link made by {share.by} on {formatDate(share.at)}.{" "}
            {students ? "Students in the course see it there too." : "Students in the course don't see it yet; anyone with the link does."}
          </p>
          {dirty && (
            <p className="mt-4 rounded-2xl bg-highlighter/45 px-4 py-3 text-sm">
              You have unsaved changes. The link shows the saved version until you save.
            </p>
          )}
          {deck.canShare && <div className="mt-5">{notesOption}</div>}
          {error && (
            <div className="mt-4">
              <FormError>{error}</FormError>
            </div>
          )}
          {confirm ? (
            <div className="mt-6 rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
              <p className="font-medium">{confirm === "renew" ? "Make a new link?" : "Stop sharing?"}</p>
              <p className="mt-1 text-sm leading-relaxed text-graphite">
                {confirm === "renew"
                  ? "The current link stops working at once: anyone who opens it is told it isn't available. Share the new one instead."
                  : "The link stops working at once. You can share again later, with a new link."}
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
                  Keep this link
                </Button>
                <Button
                  size="sm"
                  variant={confirm === "renew" ? "ink" : "danger"}
                  disabled={busy}
                  onClick={() => void run(confirm === "renew" ? () => onShare({ notes, newLink: true }) : onStop)}
                >
                  {confirm === "renew" ? (busy ? "Making it…" : "Make a new link") : busy ? "Stopping…" : "Stop sharing"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              {deck.canShare ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm("renew")}>
                    New link
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm("stop")}>
                    Stop sharing
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-graphite">Only the course&apos;s owner can change or stop this link.</p>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The link as a ticket: the deck's cover, who can watch, the address, Copy and Open. */
function LinkCard({ deck, url }: { deck: PresentationDetail; url: string }) {
  return (
    <div className="notch-sides mt-6 rounded-[2rem] bg-ink p-5 text-paper [--notch-y:47%] sm:p-6">
      <div className="flex items-center gap-4">
        <DeckCover theme={deck.theme} title={deck.title} className="w-28 ring-1 ring-paper/15" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/55">Anyone with the link can watch</p>
          <p className="mt-1.5 break-words text-lg font-medium leading-snug">{deck.title}</p>
        </div>
      </div>
      <p className="mt-6 select-all break-all border-t border-dashed border-paper/20 pt-5 font-mono text-sm leading-relaxed">{url}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton value={url} label="Copy link" variant="lime" />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={`${buttonClass("outline", "sm")} border-paper/25 text-paper hover:bg-paper/10`}
        >
          Open
          <ArrowUpRight className="size-4" />
        </a>
      </div>
    </div>
  );
}
