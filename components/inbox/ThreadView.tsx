"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { FormError, TextArea } from "@/components/ui/form";
import { ArrowLeft, ArrowUpRight, Layers, ListChecks, Notebook } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { STATUS_TONE } from "./InboxView";
import { newClientOpId, STAFF_STATUS_LABEL, topicText, type Thread } from "./types";

/**
 * One conversation from the staff side: what the student wrote, where they
 * were writing from (with links to the course, week and assessment), and the
 * reply box. Messages are plain text, never HTML.
 */
export function ThreadView({
  thread,
  onReply,
  onResolve,
}: {
  thread: Thread;
  onReply: (args: { clientOpId: string; body: string }) => Promise<void>;
  onResolve: (resolved: boolean) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per message being written: a retry after a timeout reuses it, so it's saved once.
  const opId = useRef(newClientOpId());
  const end = useRef<HTMLDivElement>(null);
  const resolved = thread.status === "resolved";

  // A message arriving while the thread is open scrolls it into view; opening the page doesn't jump.
  const seen = useRef(thread.messages.length);
  useEffect(() => {
    if (thread.messages.length > seen.current) {
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    seen.current = thread.messages.length;
  }, [thread.messages.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onReply({ clientOpId: opId.current, body });
      opId.current = newClientOpId();
      setBody("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved() {
    setError(null);
    try {
      await onResolve(!resolved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const { context } = thread;

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <Link href="/inbox" className="inline-flex items-center gap-2 text-sm text-graphite hover:text-ink">
        <ArrowLeft className="size-4" />
        Inbox
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONE[thread.status]}>{STAFF_STATUS_LABEL[thread.status]}</Pill>
            {thread.viewer === "admin" && <Pill tone="ink">To the Kalami team</Pill>}
            <Pill>{topicText(thread)}</Pill>
          </div>
          <h1 className="mt-3 break-words text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-5xl">
            {thread.subject}
          </h1>
          <p className="mt-3 text-[15px] text-graphite">
            From <span className="font-medium text-ink">{thread.studentName}</span>
            {thread.studentEmail && <> · {thread.studentEmail}</>}
          </p>
        </div>
        <Button variant="outline" onClick={toggleResolved}>
          {resolved ? "Reopen" : "Mark as resolved"}
        </Button>
      </div>

      <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <section className="rounded-[2rem] bg-card p-4 sm:p-6 lg:col-span-8">
          {thread.truncated && <p className="mb-4 text-center text-xs text-graphite">Older messages aren&apos;t shown.</p>}
          <ol className="space-y-3">
            {thread.messages.map((message) => (
              <li key={message._id} className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-3xl px-4 py-3 ${
                    message.from === "staff" ? "rounded-br-lg bg-ink text-paper" : "rounded-bl-lg bg-panel text-ink"
                  }`}
                >
                  <p className={`text-xs ${message.from === "staff" ? "text-paper/60" : "text-graphite"}`}>
                    {message.mine ? "You" : message.senderName} · {formatDateTime(message._creationTime)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div ref={end} />

          <form onSubmit={submit} className="mt-6 border-t border-dashed border-ink/15 pt-5">
            <label htmlFor="reply" className="text-sm font-medium">
              Reply to {thread.studentName}
            </label>
            <TextArea
              id="reply"
              className="mt-2"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              placeholder="Write your answer…"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-graphite">
                {thread.studentName} gets an email saying you replied (without your text), and reads it in Kalami.
                {resolved && " Replying reopens the conversation."}
              </p>
              <Button type="submit" disabled={busy || body.trim() === ""}>
                {busy ? "Sending…" : "Send reply"}
              </Button>
            </div>
            {error && (
              <div className="mt-3">
                <FormError>{error}</FormError>
              </div>
            )}
          </form>
        </section>

        <aside className="space-y-4 lg:col-span-4">
          <section className="rounded-[2rem] bg-card p-6">
            <h2 className="text-xl font-medium tracking-tight">Where they were</h2>
            <p className="mt-1 text-sm text-graphite">What the student was looking at when they wrote, checked by Kalami.</p>
            {!context.course && !context.week && !context.assessment ? (
              <p className="mt-4 text-sm text-graphite">No course attached.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {context.course && (
                  <ContextLink href={`/courses/${context.course._id}`} icon={<Layers className="size-4" />} label="Course">
                    {context.course.title}
                  </ContextLink>
                )}
                {context.week && context.course && (
                  <ContextLink
                    href={context.week.url ?? `/courses/${context.course._id}`}
                    external={context.week.url !== undefined}
                    icon={<Notebook className="size-4" />}
                    label="Week"
                  >
                    {context.week.title}
                  </ContextLink>
                )}
                {context.assessment && context.course && (
                  <ContextLink
                    href={`/courses/${context.course._id}/assessments/${context.assessment._id}`}
                    icon={<ListChecks className="size-4" />}
                    label="Assessment"
                  >
                    {context.assessment.title}
                  </ContextLink>
                )}
              </ul>
            )}
            {thread.topic === "materials_access" && context.course && (
              <p className="mt-4 rounded-2xl bg-highlighter/40 px-4 py-3 text-sm leading-relaxed">
                Check the week is published and shared on the{" "}
                <Link href={`/courses/${context.course._id}`} className="font-medium underline underline-offset-4">
                  course page
                </Link>
                . Drive weeks open for anyone with the link once sharing has finished.
              </p>
            )}
          </section>
          <p className="px-2 text-xs leading-relaxed text-graphite">
            {thread.viewer === "admin"
              ? "Only super admins see messages to the Kalami team. The student sees replies as coming from the team."
              : "Only you and the student see this conversation. University admins and other lecturers don't."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function ContextLink({
  href,
  external = false,
  icon,
  label,
  children,
}: {
  href: string;
  external?: boolean;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-graphite">{label}</span>
        <span className="block truncate text-sm font-medium">{children}</span>
      </span>
      {external && <ArrowUpRight className="size-4 shrink-0 text-graphite" />}
    </>
  );
  const className = "flex items-center gap-3 rounded-2xl border border-line bg-paper px-3 py-2.5 hover:border-ink/30";
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      ) : (
        <Link href={href} className={className}>
          {content}
        </Link>
      )}
    </li>
  );
}
