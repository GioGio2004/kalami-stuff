"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { ArrowLeft, ArrowRight, Clock, ListChecks, Plus, Robot, Shield } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { ActivityList } from "./ActivityList";
import { CourseForm } from "./CourseForm";
import {
  INTEGRITY_LABEL,
  KIND_LABEL,
  type Assessment,
  type AssessmentKind,
  type AuditEntry,
  type CourseDetail,
  type NewAssessmentArgs,
  type UpdateCourseArgs,
} from "./types";

const KINDS: AssessmentKind[] = ["task", "quiz", "midterm", "final"];

const KIND_BLURB: Record<AssessmentKind, string> = {
  task: "Homework in the code sandbox: HTML and CSS in small steps, checked as students type. Best drafted by your agent.",
  quiz: "Short checks between lessons. Standard integrity, results after close.",
  midterm: "The mid-semester exam. Strict integrity and a 60-minute timer by default.",
  final: "The end-of-semester exam. Strict integrity and a 90-minute timer by default.",
};

export function CourseView({
  course,
  history,
  onUpdateCourse,
  onCreateAssessment,
  onNewJoinCode,
  onSetJoining,
}: {
  course: CourseDetail;
  history: AuditEntry[] | undefined;
  onUpdateCourse: (args: UpdateCourseArgs) => Promise<void>;
  onCreateAssessment: (args: NewAssessmentArgs) => Promise<void>;
  onNewJoinCode: () => Promise<void>;
  onSetJoining: (enabled: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [newKind, setNewKind] = useState<AssessmentKind | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const canEdit = course.canEdit && course.status !== "archived";

  async function setCourseStatus(status: "draft" | "published") {
    setStatusBusy(true);
    setStatusError(null);
    try {
      await onUpdateCourse({ status });
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setStatusBusy(false);
    }
  }

  async function joinAction(action: () => Promise<void>) {
    setJoinError(null);
    try {
      await action();
    } catch (error) {
      setJoinError(errorMessage(error));
    }
  }

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <Link href="/courses" className="inline-flex items-center gap-2 text-sm text-graphite hover:text-ink">
        <ArrowLeft className="size-4" />
        My courses
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(course.status)}>{statusLabel(course.status)}</Pill>
            {course.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Created by an agent
              </Pill>
            )}
            {!course.canEdit && <Pill>View only</Pill>}
          </div>
          <h1 className="mt-3 text-4xl font-medium leading-[0.98] tracking-[-0.04em] sm:text-6xl">{course.title}</h1>
          <p className="mt-3 text-[15px] text-graphite">
            {[course.semester, course.universityName.en, course.locale === "ka" ? "ქართული" : "English"]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {course.description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed">{course.description}</p>}
        </div>
        {course.canEdit && (
          <div className="flex flex-wrap gap-2.5">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit details
            </Button>
            {course.status === "draft" && (
              <Button onClick={() => setCourseStatus("published")} disabled={statusBusy}>
                Publish course
              </Button>
            )}
            {course.status === "published" && (
              <Button variant="ghost" onClick={() => setCourseStatus("draft")} disabled={statusBusy}>
                Unpublish
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 max-w-3xl px-1 text-sm leading-relaxed text-graphite">{courseNote(course)}</p>
      {statusError && (
        <div className="mt-4">
          <FormError>{statusError}</FormError>
        </div>
      )}

      <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {KINDS.map((kind) => {
            const items = course.assessments.filter((a) => a.kind === kind);
            return (
              <section key={kind} className="rounded-[2rem] bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium tracking-tight">
                      {kind === "quiz" ? "Quizzes" : KIND_LABEL[kind]}
                      <span className="ml-2 text-base font-normal text-graphite">{items.length}</span>
                    </h2>
                    <p className="mt-0.5 text-sm text-graphite">{KIND_BLURB[kind]}</p>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant={items.length === 0 ? "ink" : "outline"} onClick={() => setNewKind(kind)}>
                      <Plus className="size-4" />
                      New {KIND_LABEL[kind].toLowerCase()}
                    </Button>
                  )}
                </div>
                {items.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {items.map((assessment) => (
                      <li key={assessment._id}>
                        <AssessmentRow assessment={assessment} courseId={course._id} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <section className="notch-sides rounded-[2rem] bg-ink p-6 text-paper [--notch-y:38%]">
            <p className="text-xs uppercase tracking-[0.18em] text-paper/55">Join code</p>
            <p className={`mt-2 font-mono text-4xl font-semibold tracking-[0.16em] ${course.joinEnabled ? "" : "text-paper/40 line-through"}`}>
              {course.joinCode}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-paper/65">
              Students will use this code to join your course in the student app. Joining by code is coming soon, so
              you can share it ahead of time.{" "}
              {course.joinEnabled
                ? "Switch it off once everyone is in; New code replaces this one and the old code stops working."
                : "Joining is switched off: nobody new can join with it."}
            </p>
            {course.canEdit && (
              <div className="mt-5 flex flex-wrap gap-2">
                <CopyButton value={course.joinCode} variant="lime" />
                <Button size="sm" variant="outline" className="border-paper/25 text-paper hover:bg-paper/10" onClick={() => joinAction(onNewJoinCode)}>
                  New code
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-paper/25 text-paper hover:bg-paper/10"
                  onClick={() => joinAction(() => onSetJoining(!course.joinEnabled))}
                >
                  {course.joinEnabled ? "Switch off" : "Switch on"}
                </Button>
              </div>
            )}
            {joinError && <p className="mt-3 text-sm text-red-pen">{joinError}</p>}
          </section>

          <section className="rounded-[2rem] bg-highlighter p-6">
            <span className="grid size-11 place-items-center rounded-full bg-ink text-highlighter">
              <Robot className="size-5" />
            </span>
            <h2 className="mt-5 text-xl font-medium tracking-tight">Ask your agent</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/75">
              With the connector set up, tell your AI assistant something like:
            </p>
            <p className="mt-3 -rotate-1 rounded-2xl bg-paper px-4 py-3 font-hand text-[1.25rem] leading-tight text-ink">
              “Draft a 10-question quiz on week 3 for my course ‘{course.title}’.”
            </p>
            <Link href="/agents" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
              Set up the connector
              <ArrowRight className="size-4" />
            </Link>
          </section>

          <section className="rounded-[2rem] bg-card p-6">
            <h2 className="text-xl font-medium tracking-tight">History</h2>
            <div className="mt-4">
              <ActivityList entries={history} emptyText="No changes yet." />
            </div>
          </section>
        </div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} label="Edit course">
        <div className="p-6 sm:p-10">
          <h2 className="text-3xl font-medium tracking-[-0.03em]">Edit course</h2>
          <div className="mt-6">
            <CourseForm
              course={course}
              onSubmit={async (args) => {
                await onUpdateCourse({
                  title: args.title,
                  description: args.description ?? "",
                  semester: args.semester ?? "",
                  locale: args.locale,
                });
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        </div>
      </Dialog>

      <Dialog open={newKind !== null} onClose={() => setNewKind(null)} label="New assessment">
        {newKind && (
          <NewAssessmentForm
            kind={newKind}
            onSubmit={async (args) => {
              await onCreateAssessment(args);
              setNewKind(null);
            }}
            onCancel={() => setNewKind(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

/** What the course's status means for students, and who can change it. */
function courseNote(course: CourseDetail): string {
  if (!course.canEdit) {
    return "View only: you can look around, but only the course owner and your university admin can change it.";
  }
  switch (course.status) {
    case "draft":
      return "Draft course: students can’t find it yet. Publish it when it’s ready. Each quiz and exam inside is published separately, so students only ever see what you’ve released.";
    case "published":
      return "Published: students can find this course. Quizzes and exams still stay hidden until you publish each one.";
    case "archived":
      return "Archived: hidden from students and read-only.";
  }
}

function AssessmentRow({ assessment, courseId }: { assessment: Assessment; courseId: CourseDetail["_id"] }) {
  const { settings } = assessment;
  return (
    <Link
      href={`/courses/${courseId}/assessments/${assessment._id}`}
      className="flex items-center gap-4 rounded-2xl border border-line bg-paper px-4 py-3 transition hover:border-ink/30"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
        <ListChecks className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{assessment.title}</span>
          <Pill tone={statusTone(assessment.status)}>{statusLabel(assessment.status)}</Pill>
          {assessment.createdVia === "mcp" && (
            <Pill tone="lime">
              <Robot className="size-3.5" />
              Agent
            </Pill>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite">
          <span>
            {assessment.questionCount} question{assessment.questionCount === 1 ? "" : "s"} · {assessment.totalPoints} pts
          </span>
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3.5" />
            {INTEGRITY_LABEL[settings.integrityLevel]}
          </span>
          {settings.timeLimitMin && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {settings.timeLimitMin} min
            </span>
          )}
          {settings.opensAt && <span>Opens {formatDateTime(settings.opensAt)}</span>}
        </span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-graphite" />
    </Link>
  );
}

function NewAssessmentForm({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: AssessmentKind;
  onSubmit: (args: NewAssessmentArgs) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ kind, title });
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A blank one</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">New {KIND_LABEL[kind].toLowerCase()}</h2>
      <p className="mt-2 text-[15px] text-graphite">{KIND_BLURB[kind]} You can change every setting afterwards.</p>
      <div className="mt-6">
        <Field label="Title" htmlFor="assessment-title">
          <TextInput
            id="assessment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "quiz" ? "Week 3 · CSS selectors" : `${KIND_LABEL[kind]} · Spring 2026`}
            maxLength={160}
            autoFocus
            required
          />
        </Field>
      </div>
      {error && <div className="mt-4"><FormError>{error}</FormError></div>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || title.trim() === ""}>
          Create draft
        </Button>
      </div>
    </form>
  );
}
