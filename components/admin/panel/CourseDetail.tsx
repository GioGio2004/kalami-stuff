"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { EmptyNote, Fact, StatTile } from "@/components/admin/panel/ui";
import { KIND_LABEL, type AdminCourseDetail } from "@/components/admin/types";
import { Button, ButtonLink } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, Segmented, TextInput } from "@/components/ui/form";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";

type Status = "draft" | "published" | "archived";
type AssessmentId = AdminCourseDetail["assessments"][number]["_id"];

export type CourseActions = {
  onSetStatus: (status: Status) => Promise<void>;
  onSetJoining: (enabled: boolean) => Promise<void>;
  onNewJoinCode: () => Promise<void>;
  onTransfer: (newOwnerEmail: string) => Promise<void>;
  /** Deletes the course for good; the dialog closes afterwards. */
  onDelete: () => Promise<void>;
  onSetAssessmentStatus: (assessmentId: AssessmentId, status: Status) => Promise<void>;
};

const STATUS_OPTIONS = [
  { value: "draft" as const, label: "Draft" },
  { value: "published" as const, label: "Published" },
  { value: "archived" as const, label: "Archived" },
];

export function CourseDetailDialog({
  detail,
  open,
  onClose,
  actions,
}: {
  detail: AdminCourseDetail | undefined;
  open: boolean;
  onClose: () => void;
  actions: CourseActions;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Course" size="lg">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-8">
        {detail === undefined ? (
          <div className="flex justify-center py-16">
            <WritingDots label="Loading the course" />
          </div>
        ) : (
          <CourseDetailBody detail={detail} actions={actions} />
        )}
      </div>
    </Dialog>
  );
}

export function CourseDetailBody({ detail, actions }: { detail: AdminCourseDetail; actions: CourseActions }) {
  const { course } = detail;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [transferred, setTransferred] = useState<string | null>(null);
  const emailId = useId();

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function transfer(event: FormEvent) {
    event.preventDefault();
    const email = newOwner.trim();
    await run("transfer", async () => {
      await actions.onTransfer(email);
      setTransferred(email);
      setNewOwner("");
    });
  }

  return (
    <div className="space-y-7">
      <header className="pr-10">
        <p className="-rotate-1 font-hand text-[1.3rem] leading-none text-graphite">Course</p>
        <h2 className="mt-1 flex flex-wrap items-center gap-2.5 text-3xl font-medium tracking-[-0.03em]">
          {course.title}
          <Pill tone={statusTone(course.status)}>{statusLabel(course.status)}</Pill>
        </h2>
        <p className="mt-1 text-sm text-graphite">
          {course.universityName?.en ?? "No university"}
          {course.semester ? ` · ${course.semester}` : ""} · {course.locale === "ka" ? "Georgian" : "English"} · made{" "}
          {course.createdVia === "mcp" ? "by an agent" : "in the studio"} {formatDate(course._creationTime)}
        </p>
        {course.description && <p className="mt-2 max-w-2xl text-sm leading-relaxed">{course.description}</p>}
        <div className="mt-3">
          <ButtonLink href={`/courses/${course._id}`} size="sm" variant="outline">
            Open in the studio
          </ButtonLink>
        </div>
      </header>

      <div className="grid gap-2.5 sm:grid-cols-4">
        <StatTile label="Students" value={detail.enrollments.active} note={detail.enrollments.removed > 0 ? `${detail.enrollments.removed} removed` : undefined} tone="ink" />
        <StatTile label="Published" value={course.assessments.published} note="Quizzes, tasks, exams" />
        <StatTile label="Drafts" value={course.assessments.draft} />
        <StatTile label="Groups" value={detail.groups.length} note="Shared with" />
      </div>

      <section className="rounded-[1.6rem] bg-panel p-5">
        <h3 className="text-lg font-medium tracking-tight">Status and joining</h3>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Segmented label="Course status" value={course.status} options={STATUS_OPTIONS} onChange={(status) => run("status", () => actions.onSetStatus(status))} />
          <p className="max-w-sm text-xs leading-relaxed text-graphite">
            Students see a course and its published work only while it&apos;s published. Archived courses are read-only for everyone.
          </p>
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <Fact label="Join code">
            <span className="flex items-center gap-2">
              <span className="font-mono text-base">{course.joinCode}</span>
              <CopyButton value={course.joinCode} label="Copy" variant="ghost" />
            </span>
          </Fact>
          <Fact label="Joining with the code">
            <span className="flex items-center gap-2">
              {course.joinEnabled ? <Pill tone="lime">On</Pill> : <Pill>Off</Pill>}
              <Button size="sm" variant="ghost" disabled={busy === "joining"} onClick={() => run("joining", () => actions.onSetJoining(!course.joinEnabled))}>
                {course.joinEnabled ? "Turn off" : "Turn on"}
              </Button>
            </span>
          </Fact>
          <Fact label="New code">
            <Button size="sm" variant="ghost" disabled={busy === "code"} onClick={() => run("code", actions.onNewJoinCode)}>
              {busy === "code" ? "Making…" : "Make a new code"}
            </Button>
          </Fact>
        </dl>
      </section>

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Staff <span className="ml-1 text-base font-normal text-graphite">{detail.staff.length}</span>
        </h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {detail.staff.map((seat) => (
            <li key={seat.userId} className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-2 text-sm">
              <span className="font-medium">{seat.name}</span>
              {seat.email && <span className="text-graphite">{seat.email}</span>}
              <Pill tone={seat.role === "owner" ? "ink" : "paper"}>{seat.role === "owner" ? "Owner" : "Assistant"}</Pill>
            </li>
          ))}
        </ul>
        <form onSubmit={transfer} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-line p-4">
          <div className="min-w-0 flex-1 basis-64">
            <Field label="Hand the course to" htmlFor={emailId} hint="A staff member's email. They become the owner; the current owner stays as an assistant.">
              <TextInput id={emailId} type="email" required placeholder="lecturer@university.edu.ge" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={busy === "transfer"}>
            {busy === "transfer" ? "Handing over…" : "Transfer"}
          </Button>
          {transferred && (
            <p className="basis-full text-sm text-ok" role="status">
              Now owned by {transferred}.
            </p>
          )}
        </form>
      </section>

      <section>
        <h3 className="text-lg font-medium tracking-tight">
          Quizzes, tasks and exams <span className="ml-1 text-base font-normal text-graphite">{detail.assessments.length}</span>
        </h3>
        {detail.assessments.length === 0 ? (
          <div className="mt-3">
            <EmptyNote>Nothing written yet.</EmptyNote>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {detail.assessments.map((assessment) => (
              <li key={assessment._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/courses/${course._id}/assessments/${assessment._id}`} className="truncate underline-offset-4 hover:underline">
                      {assessment.title}
                    </Link>
                    <Pill>{KIND_LABEL[assessment.kind]}</Pill>
                  </p>
                  <p className="text-xs text-graphite">
                    {assessment.questionCount} question{assessment.questionCount === 1 ? "" : "s"} · {assessment.totalPoints} points
                    {assessment.closesAt !== undefined ? ` · closes ${formatDateTime(assessment.closesAt)}` : ""} · {assessment.submitted} submitted
                    {assessment.inProgress > 0 ? `, ${assessment.inProgress} in progress` : ""}
                  </p>
                </div>
                <Segmented
                  label={`Status of ${assessment.title}`}
                  value={assessment.status}
                  options={STATUS_OPTIONS}
                  onChange={(status) => run(assessment._id, () => actions.onSetAssessmentStatus(assessment._id, status))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.groups.length > 0 && (
        <section>
          <h3 className="text-lg font-medium tracking-tight">Shared with groups</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {detail.groups.map((group) => (
              <li key={group._id}>
                <Link href={`/groups/${group._id}`} className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-2 text-sm hover:bg-panel-strong">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-graphite">{group.members} students</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <FormError>{error}</FormError>}

      <section className="rounded-[1.6rem] border border-red-pen/30 p-5">
        <h3 className="text-lg font-medium tracking-tight text-red-pen">Delete this course</h3>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-graphite">
          Everything in it goes: weeks, lessons, quizzes and exams, and every student&apos;s attempts and grades. The lecturer can export
          it as a .kalami file first, from the studio.
        </p>
        {deleting ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-pen/10 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-52 text-red-pen">Delete “{course.title}” and all of its students&apos; work for good?</span>
            <Button size="sm" variant="ghost" disabled={busy === "delete"} onClick={() => setDeleting(false)}>
              Keep it
            </Button>
            <Button size="sm" variant="danger" disabled={busy === "delete"} onClick={() => run("delete", actions.onDelete)}>
              {busy === "delete" ? "Deleting…" : "Delete for good"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" className="mt-3" onClick={() => setDeleting(true)}>
            Delete course…
          </Button>
        )}
      </section>
    </div>
  );
}
