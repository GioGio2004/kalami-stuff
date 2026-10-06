"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Card, CardTitle, EmptyNote, formatCount, PanelHeader, SearchBox } from "@/components/admin/panel/ui";
import {
  ALL,
  NONE,
  ROLE_LABEL,
  type AdminUniversity,
  type AudiencePreview,
  type BroadcastArgs,
  type BroadcastAudience,
  type BroadcastRow,
  type CourseRow,
  type GroupRow,
  type PersonHit,
  type UniversityFilter,
} from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { CheckCard, Field, FormError, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/form";
import { Bell, Check, Cross, Mail, Megaphone, Monitor, Plus } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/format";

type AudienceKind = BroadcastAudience["kind"];

const TITLE_MAX = 120;
const BODY_MAX = 2000;

const KIND_OPTIONS: { value: AudienceKind; label: string; superOnly?: boolean }[] = [
  { value: "everyone", label: "Everyone", superOnly: true },
  { value: "students", label: "Students" },
  { value: "staff", label: "Lecturers & admins" },
  { value: "university", label: "A whole university" },
  { value: "group", label: "A group" },
  { value: "course", label: "A course" },
  { value: "people", label: "Specific people" },
];

export type NotificationsData = {
  universities: AdminUniversity[] | undefined;
  filter: UniversityFilter;
  isSuperAdmin: boolean;
  scopeLabel: string;
  /** Groups inside the scope, for the group picker. */
  groups: GroupRow[] | undefined;
  /** Courses matching `courseQuery` (undefined while searching). */
  courses: CourseRow[] | undefined;
  courseQuery: string;
  onCourseQuery: (query: string) => void;
  /** People matching `peopleQuery` by email (undefined while searching). */
  people: PersonHit[] | undefined;
  peopleQuery: string;
  onPeopleQuery: (query: string) => void;
  /** Who the current audience reaches (undefined while counting or without an audience). */
  preview: AudiencePreview | undefined;
  /** The audience changed: the page recounts. */
  onAudience: (audience: BroadcastAudience | null, emailEveryone: boolean) => void;
  history: BroadcastRow[] | undefined;
  now: number;
  onOpen: (broadcastId: Id<"broadcasts">) => void;
  onSend: (args: BroadcastArgs) => Promise<void>;
};

/** The notification center: compose a message for an audience, see who it reaches, send it; the messages sent so far. */
export function NotificationsView({
  universities,
  filter,
  isSuperAdmin,
  scopeLabel,
  groups,
  courses,
  courseQuery,
  onCourseQuery,
  people,
  peopleQuery,
  onPeopleQuery,
  preview,
  onAudience,
  history,
  now,
  onOpen,
  onSend,
}: NotificationsData) {
  const ids = useId();
  const [kind, setKind] = useState<AudienceKind>("students");
  const [universityPick, setUniversityPick] = useState<string>(filter ?? (isSuperAdmin ? ALL : (universities?.[0]?._id ?? ALL)));
  const [groupId, setGroupId] = useState<Id<"groups"> | null>(null);
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [picked, setPicked] = useState<PersonHit[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [emailEveryone, setEmailEveryone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const audience = useMemo<BroadcastAudience | null>(() => {
    switch (kind) {
      case "everyone":
        return { kind };
      case "students":
      case "staff":
        return {
          kind,
          universityId:
            universityPick === ALL ? undefined : universityPick === NONE ? "none" : (universityPick as Id<"universities">),
        };
      case "university":
        return universityPick === ALL || universityPick === NONE
          ? null
          : { kind, universityId: universityPick as Id<"universities"> };
      case "group":
        return groupId === null ? null : { kind, groupId };
      case "course":
        return course === null ? null : { kind, courseId: course._id };
      case "people":
        return picked.length === 0 ? null : { kind, userIds: picked.map((person) => person.userId) };
    }
  }, [kind, universityPick, groupId, course, picked]);

  const everyoneByEmail = email && emailEveryone;
  useEffect(() => {
    onAudience(audience, everyoneByEmail);
  }, [audience, everyoneByEmail, onAudience]);

  const universityName = useCallback(
    (id: string) => universities?.find((university) => university._id === id)?.name.en ?? "the university",
    [universities],
  );

  /** The audience in words, for the confirmation. */
  function describeAudience(): string {
    switch (kind) {
      case "everyone":
        return "everyone on Kalami";
      case "students":
      case "staff": {
        const who = kind === "students" ? "all students" : "all lecturers and admins";
        if (universityPick === ALL) return who;
        if (universityPick === NONE) return `${who} outside any university`;
        return `${who} at ${universityName(universityPick)}`;
      }
      case "university":
        return `everyone at ${universityName(universityPick)}`;
      case "group":
        return `the group ${groups?.find((group) => group._id === groupId)?.name ?? ""}`;
      case "course":
        return `the course ${course?.title ?? ""}`;
      case "people":
        return picked.length === 1 ? picked[0].name : `${picked.length} people`;
    }
  }

  const ready = audience !== null && title.trim().length > 0 && body.trim().length > 0;

  async function submit() {
    if (audience === null) return;
    setSending(true);
    setError(null);
    try {
      await onSend({
        title: title.trim(),
        body: body.trim(),
        link: link.trim() === "" ? undefined : link.trim(),
        audience,
        channels: { push, email },
        emailEveryone: everyoneByEmail,
      });
      setSent(title.trim());
      setTitle("");
      setBody("");
      setLink("");
      setConfirming(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  const showsUniversity = kind === "students" || kind === "staff" || kind === "university";

  return (
    <>
      <PanelHeader
        note="Reach people"
        title="Notifications"
        description={
          <>
            A message to students and staff at <span className="font-medium text-ink">{scopeLabel}</span>. Students see it under the
            bell in their app; it also goes out as a push and an email when you choose. Lecturers and admins get the email.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <Card>
          <CardTitle>New message</CardTitle>
          <div className="mt-5 space-y-8">
            <section className="space-y-4">
              <StepLabel n={1}>Who gets it</StepLabel>
              <Segmented
                label="Audience"
                value={kind}
                options={KIND_OPTIONS.filter((option) => !option.superOnly || isSuperAdmin)}
                onChange={(next) => {
                  setKind(next);
                  if (next === "university" && (universityPick === ALL || universityPick === NONE)) {
                    setUniversityPick(universities?.[0]?._id ?? ALL);
                  }
                }}
              />
              {showsUniversity && (
                <Field label="University" htmlFor={`${ids}-university`}>
                  <SelectInput id={`${ids}-university`} value={universityPick} onChange={(event) => setUniversityPick(event.target.value)}>
                    {isSuperAdmin && kind !== "university" && <option value={ALL}>Every university</option>}
                    {universities?.map((university) => (
                      <option key={university._id} value={university._id}>
                        {university.name.en}
                      </option>
                    ))}
                    {isSuperAdmin && kind !== "university" && <option value={NONE}>Outside any university</option>}
                  </SelectInput>
                </Field>
              )}
              {kind === "group" && <GroupPicker groups={groups} value={groupId} onChange={setGroupId} id={`${ids}-group`} />}
              {kind === "course" && (
                <CoursePicker courses={courses} query={courseQuery} onQuery={onCourseQuery} value={course} onChange={setCourse} id={`${ids}-course`} />
              )}
              {kind === "people" && (
                <PeoplePicker people={people} query={peopleQuery} onQuery={onPeopleQuery} picked={picked} onPicked={setPicked} id={`${ids}-people`} />
              )}
            </section>

            <section className="space-y-4">
              <StepLabel n={2}>The message</StepLabel>
              <Field label="Title" htmlFor={`${ids}-title`} hint="The push and the email subject.">
                <TextInput
                  id={`${ids}-title`}
                  value={title}
                  maxLength={TITLE_MAX}
                  placeholder="Library closed on Friday"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="Message" htmlFor={`${ids}-body`} hint={`${body.length} / ${BODY_MAX}. A blank line starts a new paragraph.`}>
                <TextArea
                  id={`${ids}-body`}
                  rows={6}
                  value={body}
                  maxLength={BODY_MAX}
                  placeholder="What people need to know, in a few sentences."
                  onChange={(event) => setBody(event.target.value)}
                />
              </Field>
              <Field
                label="Link"
                htmlFor={`${ids}-link`}
                optional
                hint="A page in the student app (/courses/…) or an https:// address: the button in the email and a tap on the push open it."
              >
                <TextInput id={`${ids}-link`} value={link} placeholder="/dashboard" onChange={(event) => setLink(event.target.value)} />
              </Field>
            </section>

            <section className="space-y-4">
              <StepLabel n={3}>How it goes out</StepLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <CheckCard checked={push} onChange={setPush}>
                  <span className="flex items-center gap-2">
                    <Monitor className="size-4 shrink-0" /> Push to students&apos; phones and computers
                  </span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-graphite">
                    Only devices where they turned notifications on. The bell in the app shows it either way.
                  </span>
                </CheckCard>
                <CheckCard checked={email} onChange={setEmail}>
                  <span className="flex items-center gap-2">
                    <Mail className="size-4 shrink-0" /> Email
                  </span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-graphite">
                    Students and staff, in their language, with a link to stop these emails.
                  </span>
                </CheckCard>
              </div>
              {email && (
                <CheckCard checked={emailEveryone} onChange={setEmailEveryone}>
                  Also email people who switched notification emails off
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-graphite">
                    For important notices only. Addresses that bounced or complained never get email.
                  </span>
                </CheckCard>
              )}
            </section>

            <PreviewBox audience={audience} preview={preview} push={push} email={email} />

            {error && !confirming && <FormError>{error}</FormError>}
            {sent !== null && (
              <p className="flex items-start gap-2.5 rounded-2xl bg-highlighter/30 px-4 py-3 text-sm">
                <Check className="mt-0.5 size-4 shrink-0" />
                <span>
                  “{sent}” is going out. The list on the right shows how far it got; open it to see who got what.
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!ready}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Megaphone className="size-4" />
                Send…
              </Button>
              <span className="text-sm text-graphite">{ready ? "You confirm first." : "Pick who gets it and write the message."}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle count={history?.length}>Sent</CardTitle>
          {history === undefined ? (
            <div className="flex justify-center py-12">
              <WritingDots label="Loading messages" />
            </div>
          ) : history.length === 0 ? (
            <div className="mt-4">
              <EmptyNote>Nothing sent yet.</EmptyNote>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {history.map((row) => (
                <li key={row._id}>
                  <button
                    type="button"
                    onClick={() => onOpen(row._id)}
                    className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-1.5 rounded-2xl px-2 py-3 text-left transition hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="flex w-full items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{row.title}</span>
                        <span className="block truncate text-xs text-graphite">{row.audienceLabel}</span>
                      </span>
                      <Pill tone={row.status === "sending" ? "lime" : "panel"}>{row.status === "sending" ? "Sending…" : "Sent"}</Pill>
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-graphite">
                      <span>{timeAgo(row._creationTime, now)}</span>
                      <span>{row.senderName}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-graphite">
                      <span className="text-ink">{formatCount(row.recipients)} reached</span>
                      <span className="inline-flex items-center gap-1">
                        <Bell className="size-3" /> {formatCount(row.inApp)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Monitor className="size-3" /> {formatCount(row.pushed)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3" /> {formatCount(row.emailed)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={confirming} onClose={() => !sending && setConfirming(false)} label="Confirm sending">
        <div className="p-6 sm:p-8">
          <h2 className="text-2xl font-medium tracking-tight">Send this message?</h2>
          <dl className="mt-5 space-y-3 text-[15px]">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">To</dt>
              <dd className="mt-0.5">
                {describeAudience()}
                {preview !== undefined && (
                  <span className="text-graphite">
                    {" "}
                    · {formatCount(preview.recipients, preview.capped)} {preview.recipients === 1 && !preview.capped ? "person" : "people"}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">Title</dt>
              <dd className="mt-0.5 font-medium">{title.trim()}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">Goes out as</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                <Pill tone="ink">Bell</Pill>
                {push && <Pill tone="ink">Push</Pill>}
                {email && <Pill tone="ink">Email{everyoneByEmail ? ", everyone" : ""}</Pill>}
              </dd>
            </div>
          </dl>
          {error && (
            <div className="mt-4">
              <FormError>{error}</FormError>
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={sending} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button disabled={sending} onClick={submit}>
              {sending ? "Sending…" : "Send now"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function StepLabel({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-lg font-medium tracking-tight">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-highlighter">{n}</span>
      {children}
    </h3>
  );
}

/** Who the message reaches, as the backend counts it right now. */
function PreviewBox({
  audience,
  preview,
  push,
  email,
}: {
  audience: BroadcastAudience | null;
  preview: AudiencePreview | undefined;
  push: boolean;
  email: boolean;
}) {
  return (
    <div className="rounded-2xl bg-panel px-5 py-4">
      {audience === null ? (
        <p className="text-sm text-graphite">Pick who gets it to see how many people that is.</p>
      ) : preview === undefined ? (
        <WritingDots label="Counting" />
      ) : (
        <>
          <p className="text-2xl font-medium tracking-tight tabular-nums">
            Reaches {formatCount(preview.recipients, preview.capped)} {preview.recipients === 1 && !preview.capped ? "person" : "people"}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-graphite">
            <li>
              {formatCount(preview.students)} students
              {push && ` · ${formatCount(preview.withPush)} with push on`}
            </li>
            {preview.staff > 0 && <li>{formatCount(preview.staff)} lecturers and admins (email only)</li>}
            {email && (
              <li>
                Email: {formatCount(preview.emailable)} get it
                {preview.optedOut > 0 && ` · ${formatCount(preview.optedOut)} switched emails off`}
                {preview.blocked > 0 && ` · ${formatCount(preview.blocked)} bounced`}
              </li>
            )}
            {preview.capped && <li>Counted the first {formatCount(preview.recipients)} only; everyone still gets it.</li>}
          </ul>
          {push && !preview.pushConfigured && (
            <p className="mt-2 text-sm text-red-pen">Push isn&apos;t set up on this server (VAPID keys), so no pushes will go out.</p>
          )}
          {email && !preview.emailConfigured && (
            <p className="mt-2 text-sm text-red-pen">Email isn&apos;t set up on this server (RESEND_API_KEY), so no emails will go out.</p>
          )}
        </>
      )}
    </div>
  );
}

function GroupPicker({
  groups,
  value,
  onChange,
  id,
}: {
  groups: GroupRow[] | undefined;
  value: Id<"groups"> | null;
  onChange: (groupId: Id<"groups">) => void;
  id: string;
}) {
  const [needle, setNeedle] = useState("");
  const query = needle.trim().toLowerCase();
  const shown = (groups ?? []).filter((group) => !group.archived && (query === "" || group.name.toLowerCase().includes(query)));
  return (
    <div className="space-y-3">
      <SearchBox id={id} label="Filter groups" placeholder="Filter groups by name" value={needle} onChange={setNeedle} className="sm:max-w-sm" />
      {groups === undefined ? (
        <WritingDots label="Loading groups" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-graphite">{groups.length === 0 ? "No groups yet." : "No group matches."}</p>
      ) : (
        <ul role="radiogroup" aria-label="Group" className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
          {shown.map((group) => {
            const active = group._id === value;
            return (
              <li key={group._id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(group._id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-ink ${
                    active ? "bg-ink text-paper" : "hover:bg-panel"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  <span className={`shrink-0 text-xs ${active ? "text-paper/70" : "text-graphite"}`}>
                    {group.universityName?.en ?? "Private"} · {formatCount(group.members)} students
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CoursePicker({
  courses,
  query,
  onQuery,
  value,
  onChange,
  id,
}: {
  courses: CourseRow[] | undefined;
  query: string;
  onQuery: (query: string) => void;
  value: CourseRow | null;
  onChange: (course: CourseRow | null) => void;
  id: string;
}) {
  return (
    <div className="space-y-3">
      {value !== null ? (
        <Chip onRemove={() => onChange(null)} label={`Remove ${value.title}`}>
          <span className="font-medium">{value.title}</span>
          <span className="text-xs text-graphite">
            {value.universityName?.en ?? "No university"} · {formatCount(value.students)} students
          </span>
        </Chip>
      ) : (
        <>
          <SearchBox id={id} label="Search courses" placeholder="Search courses by title or join code" value={query} onChange={onQuery} className="sm:max-w-sm" />
          {query.trim() === "" ? (
            <p className="text-sm text-graphite">Type to find the course.</p>
          ) : courses === undefined ? (
            <WritingDots label="Searching" />
          ) : courses.length === 0 ? (
            <p className="text-sm text-graphite">No course matches.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
              {courses.map((course) => (
                <li key={course._id}>
                  <button
                    type="button"
                    onClick={() => onChange(course)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{course.title}</span>
                    <span className="shrink-0 text-xs text-graphite">
                      {course.universityName?.en ?? "No university"} · {formatCount(course.students)} students
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PeoplePicker({
  people,
  query,
  onQuery,
  picked,
  onPicked,
  id,
}: {
  people: PersonHit[] | undefined;
  query: string;
  onQuery: (query: string) => void;
  picked: PersonHit[];
  onPicked: (picked: PersonHit[]) => void;
  id: string;
}) {
  const pickedIds = new Set(picked.map((person) => person.userId));
  return (
    <div className="space-y-3">
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {picked.map((person) => (
            <li key={person.userId}>
              <Chip onRemove={() => onPicked(picked.filter((other) => other.userId !== person.userId))} label={`Remove ${person.name}`}>
                <span className="font-medium">{person.name}</span>
                <span className="text-xs text-graphite">{person.email}</span>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <SearchBox id={id} label="Find people" placeholder="Start typing an email address" value={query} onChange={onQuery} className="sm:max-w-sm" />
      {query.trim().length < 2 ? (
        <p className="text-sm text-graphite">Students and staff alike, by the start of their email.</p>
      ) : people === undefined ? (
        <WritingDots label="Searching" />
      ) : people.length === 0 ? (
        <p className="text-sm text-graphite">Nobody matches.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
          {people.map((person) => {
            const added = pickedIds.has(person.userId);
            return (
              <li key={person.userId} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{person.name}</span>
                  <span className="block truncate text-xs text-graphite">
                    {person.email}
                    {person.universityName && ` · ${person.universityName.en}`}
                  </span>
                </span>
                {person.roles.map((role) => (
                  <Pill key={role}>{ROLE_LABEL[role]}</Pill>
                ))}
                <Button size="sm" variant={added ? "ghost" : "outline"} disabled={added} onClick={() => onPicked([...picked, person])}>
                  {added ? <Check className="size-4" /> : <Plus className="size-4" />}
                  {added ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-highlighter/30 py-1 pl-3.5 pr-1.5 text-sm">
      <span className="flex min-w-0 flex-col leading-tight">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Cross className="size-3.5" />
      </button>
    </span>
  );
}
