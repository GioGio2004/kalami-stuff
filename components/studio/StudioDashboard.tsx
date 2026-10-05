"use client";

import Link from "next/link";
import { useState } from "react";
import type { Me } from "@/components/CurrentUserProvider";
import { ArrowLink, Button, ButtonLink } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Layers, Plus, Robot, Trash } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { CourseForm } from "./CourseForm";
import { DeleteCourse } from "./DeleteCourse";
import { KalamiFileIcon } from "@/components/kalami/KalamiFile";
import { StudioIntro } from "./StudioIntro";
import type { CourseSummary, NewCourseArgs, UniversityOption } from "./types";

/** The studio home: every course the person can work on, and the intro card on the first visit. */
export function StudioDashboard({
  me,
  courses,
  universities,
  introOpenInitially,
  onCreateCourse,
  onIntroSeen,
  onImportKalami,
  onDeleteCourse,
  onExportCourse,
}: {
  me: Me;
  courses: CourseSummary[] | undefined;
  universities: UniversityOption[] | undefined;
  introOpenInitially: boolean;
  onCreateCourse: (args: NewCourseArgs) => Promise<void>;
  onIntroSeen: () => void;
  /** Opens the .kalami import dialog. */
  onImportKalami?: () => void;
  /** Deletes a course for good (the card shows a delete button when given). */
  onDeleteCourse?: (courseId: CourseSummary["_id"]) => Promise<void>;
  /** Downloads a course as .kalami, offered before deleting it. */
  onExportCourse?: (courseId: CourseSummary["_id"]) => Promise<void>;
}) {
  const [introOpen, setIntroOpen] = useState(introOpenInitially);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CourseSummary | null>(null);

  const closeIntro = () => {
    setIntroOpen(false);
    onIntroSeen();
  };

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6 px-1">
        <div>
          <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">
            Your studio{me.firstName ? `, ${me.firstName}` : ""}
          </p>
          <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">My courses</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="ghost" onClick={() => setIntroOpen(true)}>
            How it works
          </Button>
          <ButtonLink href="/agents" variant="outline">
            <Robot className="size-4" />
            Agents
          </ButtonLink>
          {onImportKalami && (
            <Button variant="outline" onClick={onImportKalami}>
              <KalamiFileIcon className="h-5 w-auto" decorative />
              Import .kalami
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New course
          </Button>
        </div>
      </div>

      <div className="mt-10">
        {courses === undefined ? (
          <div className="rounded-[2rem] bg-card p-8 text-graphite">Loading your courses…</div>
        ) : courses.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} onHow={() => setIntroOpen(true)} />
        ) : (
          <ul className="grid gap-4 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <li key={course._id}>
                <CourseCard
                  course={course}
                  onDelete={onDeleteCourse && course.canEdit ? () => setDeleting(course) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} label="New course">
        <div className="p-6 sm:p-10">
          <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A new folder</p>
          <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">New course</h2>
          <p className="mt-2 text-[15px] text-graphite">
            It starts as a draft with a join code. Add quizzes and exams inside it.
          </p>
          <div className="mt-6">
            <CourseForm
              universities={universities}
              defaultLocale={me.locale}
              onSubmit={async (args) => {
                await onCreateCourse(args);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </div>
      </Dialog>

      {onDeleteCourse && (
        <DeleteCourse
          course={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async (courseId) => {
            await onDeleteCourse(courseId);
            setDeleting(null);
          }}
          onExport={onExportCourse}
        />
      )}

      <StudioIntro open={introOpen} onClose={closeIntro} />
    </div>
  );
}

function CourseCard({ course, onDelete }: { course: CourseSummary; onDelete?: () => void }) {
  const { counts } = course;
  const parts = [
    counts.tasks > 0 && `${counts.tasks} task${counts.tasks === 1 ? "" : "s"}`,
    counts.quizzes > 0 && `${counts.quizzes} quiz${counts.quizzes === 1 ? "" : "zes"}`,
    counts.midterms > 0 && `${counts.midterms} midterm${counts.midterms === 1 ? "" : "s"}`,
    counts.finals > 0 && `${counts.finals} final${counts.finals === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <article className="notch-top flex h-full flex-col rounded-[2rem] bg-card p-6 pt-8">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-panel text-ink">
          <Layers className="size-5" />
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {course.createdVia === "mcp" && (
            <Pill tone="lime">
              <Robot className="size-3.5" />
              Agent
            </Pill>
          )}
          <Pill tone={statusTone(course.status)}>{statusLabel(course.status)}</Pill>
        </div>
      </div>
      <h3 className="mt-6 text-2xl font-medium leading-tight tracking-tight">
        <Link href={`/courses/${course._id}`} className="hover:underline hover:underline-offset-4">
          {course.title}
        </Link>
      </h3>
      <p className="mt-1.5 text-sm text-graphite">
        {[course.semester, course.universityName?.en].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-4 text-[15px] text-ink/80">
        {parts.length > 0 ? parts.join(" · ") : "No assessments yet"}
        {counts.drafts > 0 && <span className="text-graphite"> · {counts.drafts} draft{counts.drafts === 1 ? "" : "s"}</span>}
      </p>
      <p className={`mt-1 text-sm ${course.students === 0 ? "font-medium text-red-pen" : "text-graphite"}`}>
        {course.students === 0
          ? "No students yet: share the join code"
          : `${course.students} student${course.students === 1 ? "" : "s"}`}
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-6">
        <div>
          <p className="text-xs text-graphite">Join code</p>
          <p className={`font-mono text-lg font-semibold tracking-[0.14em] ${course.joinEnabled ? "" : "text-graphite line-through"}`}>
            {course.joinCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${course.title}`}
              title="Delete course"
              className="grid size-11 place-items-center rounded-full text-graphite transition hover:bg-red-pen/10 hover:text-red-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <Trash className="size-[18px]" />
            </button>
          )}
          <ArrowLink href={`/courses/${course._id}`}>{course.canEdit ? "Open" : "View"}</ArrowLink>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ onCreate, onHow }: { onCreate: () => void; onHow: () => void }) {
  const steps = [
    { title: "Create a course", text: "A title and a semester. Students join it with a code later." },
    { title: "Add a quiz, midterm or final", text: "By hand in the builder, or ask your AI agent to draft it." },
    { title: "Review and publish", text: "Drafts are yours alone until you press Publish." },
  ];
  return (
    <section className="notch-top grid gap-8 rounded-[2rem] bg-card p-6 pt-8 sm:p-8 sm:pt-10 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col">
        <p className="-rotate-2 font-hand text-[1.7rem] leading-none text-graphite">Blank notebook</p>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">No courses yet</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-graphite">
          Three steps from here to a published quiz. The second one can be done by your own AI assistant.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={onCreate}>
            <Plus className="size-4" />
            New course
          </Button>
          <Button variant="outline" onClick={onHow}>
            How it works
          </Button>
        </div>
      </div>
      <ol className="space-y-4 self-center">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-highlighter text-sm font-semibold text-ink">
              {index + 1}
            </span>
            <span>
              <span className="block font-medium">{step.title}</span>
              <span className="text-sm text-graphite">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
