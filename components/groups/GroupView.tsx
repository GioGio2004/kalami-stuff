"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, SelectInput, TextArea } from "@/components/ui/form";
import { ArrowLeft, Layers, Mail, Users } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { CourseSummary } from "@/components/studio/types";
import { NewGroupForm } from "./GroupsDashboard";
import { groupJoinUrl, type GroupDetail, type GroupInvite, type GroupLecturer, type InviteResult } from "./types";

export type GroupActions = {
  onUpdate: (patch: { name?: string; description?: string; archived?: boolean }) => Promise<void>;
  onNewLink: () => Promise<void>;
  onSetLink: (enabled: boolean) => Promise<void>;
  onInvite: (emails: string) => Promise<InviteResult>;
  onResend: (inviteId: GroupInvite["_id"]) => Promise<boolean>;
  onWithdraw: (inviteId: GroupInvite["_id"]) => Promise<void>;
  onRemoveStudent: (userId: GroupDetail["memberList"][number]["userId"]) => Promise<void>;
  onShareCourse: (courseId: CourseSummary["_id"]) => Promise<void>;
  onUnshareCourse: (courseId: CourseSummary["_id"]) => Promise<void>;
  /** A lecturer stops teaching the group; their courses leave it. */
  onLeave: () => Promise<void>;
  /** Whoever runs the group takes a lecturer off it. */
  onRemoveLecturer: (userId: GroupLecturer["userId"]) => Promise<void>;
};

/**
 * One group. Whoever runs it (a university admin, or the teacher of a private
 * group) gets its invite link, email invites, students and lecturers. A
 * lecturer who teaches it gets the link to share, their own courses in it and
 * a way to leave; its students are the admins' to manage.
 */
export function GroupView({
  group,
  courses,
  now,
  actions,
}: {
  group: GroupDetail;
  /** The lecturer's courses, for "Share a course". */
  courses: CourseSummary[] | undefined;
  now: number;
  actions: GroupActions;
}) {
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = !group.archived;
  const manages = group.manages;
  // An admin who doesn't teach the group came from the admin page.
  const back = manages && !group.teaches && !group.isPrivate ? { href: "/admin/groups", label: "Admin" } : { href: "/groups", label: "Groups" };
  const totalCourses = group.courses.length + group.otherCourses;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <Link href={back.href} className="inline-flex items-center gap-2 text-sm text-graphite hover:text-ink">
        <ArrowLeft className="size-4" />
        {back.label}
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {group.archived && <Pill>Archived</Pill>}
            {group.universityName && <Pill tone="panel">{group.universityName.en}</Pill>}
            {group.teaches && !group.isPrivate && <Pill tone="lime">You teach it</Pill>}
          </div>
          <h1 className="mt-3 break-words text-4xl font-medium leading-[0.98] tracking-[-0.04em] sm:text-6xl">
            {group.name}
          </h1>
          <p className="mt-3 text-[15px] text-graphite">
            {group.members} student{group.members === 1 ? "" : "s"} · {totalCourses} course
            {totalCourses === 1 ? "" : "s"}
            {!group.isPrivate && ` · ${group.lecturers} lecturer${group.lecturers === 1 ? "" : "s"}`}
          </p>
          {group.description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{group.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {manages && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => run(() => actions.onUpdate({ archived: live }))}>
                {live ? "Archive" : "Restore"}
              </Button>
            </>
          )}
          {group.teaches && !group.isPrivate && (
            <Button variant="ghost" onClick={() => setLeaving(true)}>
              Leave group…
            </Button>
          )}
        </div>
      </div>
      {group.archived && (
        <p className="mt-4 max-w-3xl px-1 text-sm leading-relaxed text-graphite">
          Archived: nobody new can join, but the students keep the courses shared with this group.
        </p>
      )}
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}

      <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {manages ? (
            <>
              {live && <EmailInvites group={group} now={now} actions={actions} />}
              <Members group={group} actions={actions} onError={setError} />
              {!group.isPrivate && <Lecturers group={group} actions={actions} onError={setError} />}
            </>
          ) : (
            <StudentsNote group={group} />
          )}
        </div>

        {/* The link comes first on phones: it's what a lecturer opens this page for. */}
        <div className="order-first space-y-4 lg:order-none lg:col-span-4">
          {live && <InviteLink group={group} actions={actions} onError={setError} />}
          <SharedCourses group={group} courses={courses} actions={actions} onError={setError} />
        </div>
      </div>

      {manages && (
        <Dialog open={editing} onClose={() => setEditing(false)} label="Edit group">
          <NewGroupForm
            initial={{ name: group.name, description: group.description }}
            noteHint={group.isPrivate ? "Only you see this." : "Lecturers see this when they look for the group."}
            onSubmit={async (args) => {
              await actions.onUpdate({ name: args.name, description: args.description ?? "" });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Dialog>
      )}

      <Dialog open={leaving} onClose={() => setLeaving(false)} label="Leave group">
        {leaving && <LeaveGroup group={group} onLeave={actions.onLeave} onCancel={() => setLeaving(false)} />}
      </Dialog>
    </div>
  );
}

/** A lecturer leaving: their courses go too, which students notice. */
function LeaveGroup({ group, onLeave, onCancel }: { group: GroupDetail; onLeave: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = group.courses.length;
  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Stop teaching “{group.name}”?</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-graphite">
        {mine === 0
          ? "None of your courses are shared with it, so its students won't notice."
          : `${mine === 1 ? "Your course leaves" : `Your ${mine} courses leave`} the group too: its students keep ${
              mine === 1 ? "it" : "them"
            } only if they joined another way, like the join code. Their submitted work stays.`}{" "}
        You can join again later.
      </p>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Keep teaching it
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onLeave();
            } catch (caught) {
              setError(errorMessage(caught));
              setBusy(false);
            }
          }}
        >
          {busy ? "Leaving…" : "Leave group"}
        </Button>
      </div>
    </div>
  );
}

/** For a lecturer who teaches the group: who's in it is the admins' to manage. */
function StudentsNote({ group }: { group: GroupDetail }) {
  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          <Users className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-medium tracking-tight">
            Students <span className="ml-1 text-base font-normal text-graphite">{group.members}</span>
          </h2>
          <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-graphite">
            Your university&apos;s admins manage who&apos;s in this group. Share the invite link with students who
            aren&apos;t in yet; you&apos;ll see them in your courses once they join.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Who teaches the group, for whoever runs it. */
function Lecturers({
  group,
  actions,
  onError,
}: {
  group: GroupDetail;
  actions: GroupActions;
  onError: (message: string | null) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          <Layers className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-medium tracking-tight">
            Lecturers <span className="ml-1 text-base font-normal text-graphite">{group.lecturerList.length}</span>
          </h2>
          <p className="mt-0.5 text-sm text-graphite">
            Lecturers join the groups they teach themselves. Taking one off also takes their courses out of the group.
          </p>
        </div>
      </div>
      {group.lecturerList.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-graphite">
          No lecturer teaches it yet. They find it under Groups and join it.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line rounded-2xl border border-line bg-paper">
          {group.lecturerList.map((lecturer) => (
            <li key={lecturer.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{lecturer.name}</span>
                <span className="block text-xs text-graphite">joined {formatDate(lecturer.joinedAt)}</span>
              </span>
              {confirming === lecturer.userId ? (
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      onError(null);
                      try {
                        await actions.onRemoveLecturer(lecturer.userId);
                      } catch (caught) {
                        onError(errorMessage(caught));
                      }
                      setConfirming(null);
                    }}
                  >
                    Take off
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(lecturer.userId)}>
                  Take off…
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteLink({
  group,
  actions,
  onError,
}: {
  group: GroupDetail;
  actions: GroupActions;
  onError: (message: string | null) => void;
}) {
  const url = groupJoinUrl(group.inviteCode);
  async function run(action: () => Promise<void>) {
    onError(null);
    try {
      await action();
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }
  return (
    <section className="notch-sides rounded-[2rem] bg-ink p-6 text-paper [--notch-y:42%]">
      <p className="text-xs uppercase tracking-[0.18em] text-paper/55">Invite link</p>
      <p className={`mt-3 break-all font-mono text-sm leading-relaxed ${group.inviteEnabled ? "" : "text-paper/40 line-through"}`}>
        {url}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-paper/65">
        {group.inviteEnabled
          ? group.manages
            ? "Anyone with this link can join after signing in, with any email. Post it in your class chat or on the board. Close it once everyone is in."
            : "Anyone with this link can join after signing in. Post it in your class chat or on the board. Only your university's admins can change or close it."
          : group.manages
            ? "The link is closed: nobody new can join with it."
            : "The link is closed: nobody new can join with it. Ask your university admin to open it."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {group.inviteEnabled && <CopyButton value={url} label="Copy link" variant="lime" />}
        {group.manages && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="border-paper/25 text-paper hover:bg-paper/10"
              onClick={() => run(actions.onNewLink)}
            >
              New link
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-paper/25 text-paper hover:bg-paper/10"
              onClick={() => run(() => actions.onSetLink(!group.inviteEnabled))}
            >
              {group.inviteEnabled ? "Close link" : "Open link"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function EmailInvites({ group, now, actions }: { group: GroupDetail; now: number; actions: GroupActions }) {
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: GroupInvite["_id"]; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await actions.onInvite(emails);
      setResult(outcome);
      // Keep only what didn't go out, so a typo can be fixed and resent.
      setEmails(outcome.invalid.join("\n"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function rowAction(id: GroupInvite["_id"], action: () => Promise<string>) {
    setRowMessage(null);
    try {
      setRowMessage({ id, text: await action() });
    } catch (caught) {
      setRowMessage({ id, text: errorMessage(caught) });
    }
  }

  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          <Mail className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-medium tracking-tight">Invite by email</h2>
          <p className="mt-0.5 text-sm text-graphite">
            Each student gets their own invite. They must sign in with that address to accept it; it also waits on
            their dashboard. For students who use another email, send the invite link instead.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <Field label="Email addresses" htmlFor="invite-emails" hint="Paste a list: commas, spaces or one per line. Up to 100 at a time.">
          <TextArea
            id="invite-emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={3}
            placeholder={"nino@gmail.com\ngiorgi@school.ge"}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        {result && <InviteSummary result={result} />}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || emails.trim() === ""}>
            {busy ? "Sending…" : "Send invites"}
          </Button>
        </div>
      </form>

      {group.inviteList.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">
            Waiting for them <span className="font-normal text-graphite">{group.inviteList.length}</span>
          </h3>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
            {group.inviteList.map((invite) => {
              const expired = invite.expiresAt < now;
              return (
                <li key={invite._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{invite.email}</span>
                    <span className="text-xs text-graphite">
                      {expired
                        ? "Expired"
                        : invite.emailedAt
                          ? `Emailed ${formatDate(invite.emailedAt)}`
                          : `Invited ${formatDate(invite.createdAt)} · not emailed`}
                      {rowMessage?.id === invite._id && <span className="text-ink"> · {rowMessage.text}</span>}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        rowAction(invite._id, async () =>
                          (await actions.onResend(invite._id)) ? "Sent again" : "Renewed (email isn't set up here)",
                        )
                      }
                    >
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        rowAction(invite._id, async () => {
                          await actions.onWithdraw(invite._id);
                          return "Withdrawn";
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function InviteSummary({ result }: { result: InviteResult }) {
  const lines = [
    result.invited.length > 0 &&
      `${result.invited.length} invited${
        result.emailed < result.invited.length
          ? result.emailed === 0
            ? " (emails aren't set up on this server, so share the invite link with them)"
            : `, ${result.emailed} emailed`
          : " and emailed"
      }.`,
    result.alreadyMembers.length > 0 && `Already in the group: ${result.alreadyMembers.join(", ")}.`,
    result.alreadyInvited.length > 0 && `Already invited: ${result.alreadyInvited.join(", ")}.`,
    result.invalid.length > 0 && `Not email addresses (left in the box): ${result.invalid.join(", ")}.`,
  ].filter((line): line is string => typeof line === "string");
  return (
    <div className="rounded-2xl bg-highlighter/40 px-4 py-3 text-sm leading-relaxed" role="status">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function Members({
  group,
  actions,
  onError,
}: {
  group: GroupDetail;
  actions: GroupActions;
  onError: (message: string | null) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          <Users className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-medium tracking-tight">
            Students <span className="ml-1 text-base font-normal text-graphite">{group.members}</span>
          </h2>
          <p className="mt-0.5 text-sm text-graphite">
            Removing a student takes away the courses they had through this group. Their submitted work stays.
          </p>
        </div>
      </div>
      {group.memberList.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-graphite">
          Nobody has joined yet. Share the invite link or send email invites.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line rounded-2xl border border-line bg-paper">
          {group.memberList.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{member.name}</span>
                <span className="block truncate text-xs text-graphite">
                  {member.email} · joined {formatDate(member.joinedAt)} by {member.via === "email" ? "email invite" : "link"}
                </span>
              </span>
              {confirming === member.userId ? (
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      onError(null);
                      try {
                        await actions.onRemoveStudent(member.userId);
                      } catch (caught) {
                        onError(errorMessage(caught));
                      }
                      setConfirming(null);
                    }}
                  >
                    Remove
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(member.userId)}>
                  Remove…
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SharedCourses({
  group,
  courses,
  actions,
  onError,
}: {
  group: GroupDetail;
  courses: CourseSummary[] | undefined;
  actions: GroupActions;
  onError: (message: string | null) => void;
}) {
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const shareable = (courses ?? []).filter(
    (c) => c.canEdit && c.status !== "archived" && !group.courses.some((shared) => shared._id === c._id),
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onError(null);
    try {
      await action();
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[2rem] bg-card p-6">
      <span className="grid size-11 place-items-center rounded-full bg-highlighter text-ink">
        <Layers className="size-5" />
      </span>
      <h2 className="mt-5 text-xl font-medium tracking-tight">{group.manages ? "Courses" : "Your courses"}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-graphite">
        Every student in the group sees these, as soon as the course is published.
        {group.otherCourses > 0 &&
          ` Other lecturers share ${group.otherCourses} more course${group.otherCourses === 1 ? "" : "s"} with it.`}
      </p>
      {group.courses.length > 0 && (
        <ul className="mt-4 space-y-2">
          {group.courses.map((course) => (
            <li key={course._id} className="rounded-2xl border border-line bg-paper py-2.5 pl-4 pr-2">
              <Link href={`/courses/${course._id}`} className="block break-words pr-2 text-sm font-medium hover:underline">
                {course.title}
              </Link>
              <div className="mt-1 flex items-center justify-between gap-2">
                <Pill tone={statusTone(course.status)}>{statusLabel(course.status)}</Pill>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => actions.onUnshareCourse(course._id))}>
                  Unshare
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shareable.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          <SelectInput aria-label="Course to share" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Share a course…</option>
            {shareable.map((course) => (
              <option key={course._id} value={course._id}>
                {course.title}
              </option>
            ))}
          </SelectInput>
          <Button
            variant="ink"
            disabled={busy || picked === ""}
            onClick={() =>
              run(async () => {
                await actions.onShareCourse(picked as CourseSummary["_id"]);
                setPicked("");
              })
            }
          >
            Share
          </Button>
        </div>
      )}
      {courses !== undefined && shareable.length === 0 && group.courses.length === 0 && (
        <p className="mt-4 text-sm text-graphite">
          <Link href="/courses" className="underline underline-offset-4">
            Create a course
          </Link>{" "}
          first, then share it here.
        </p>
      )}
    </section>
  );
}
