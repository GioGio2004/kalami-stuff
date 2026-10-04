"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { FormError } from "@/components/ui/form";
import { ArrowLeft, ArrowRight, Robot } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { KalamiFileIcon } from "@/components/kalami/KalamiFile";
import { ActivityList } from "./ActivityList";
import { CourseForm } from "./CourseForm";
import type { AuditEntry, CourseDetail, UpdateCourseArgs } from "./types";

export function CourseView({
  course,
  history,
  onUpdateCourse,
  onNewJoinCode,
  onSetJoining,
  outline,
  groups,
  onExport,
}: {
  course: CourseDetail;
  history: AuditEntry[] | undefined;
  onUpdateCourse: (args: UpdateCourseArgs) => Promise<void>;
  onNewJoinCode: () => Promise<void>;
  onSetJoining: (enabled: boolean) => Promise<void>;
  /** The main column: the course outline (CourseOutline), weeks, exams and unplaced work. */
  outline?: ReactNode;
  /** The groups card (CourseGroups), at the top of the side column. */
  groups?: ReactNode;
  /** Downloads the course as a .kalami file. */
  onExport?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportFile() {
    if (!onExport) return;
    setExporting(true);
    setStatusError(null);
    try {
      await onExport();
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

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
            {[course.semester, course.universityName?.en, course.locale === "ka" ? "ქართული" : "English"]
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
            {onExport && (
              <Button variant="outline" onClick={exportFile} disabled={exporting} title="The whole course in one file: weeks, lessons, quizzes and answer keys">
                <KalamiFileIcon className="h-5 w-auto" decorative />
                {exporting ? "Exporting…" : "Export .kalami"}
              </Button>
            )}
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
        <div className="lg:col-span-8">{outline}</div>

        <div className="space-y-4 lg:col-span-4">
          {groups}
          <section className="notch-sides rounded-[2rem] bg-ink p-6 text-paper [--notch-y:38%]">
            <p className="text-xs uppercase tracking-[0.18em] text-paper/55">Join code</p>
            <p className={`mt-2 font-mono text-4xl font-semibold tracking-[0.16em] ${course.joinEnabled ? "" : "text-paper/40 line-through"}`}>
              {course.joinCode}
            </p>
            <p className={`mt-3 text-sm font-medium ${course.students === 0 ? "text-highlighter" : "text-paper"}`}>
              {course.students === 0
                ? "No students yet. Share the course with a group, or give students this code."
                : `${course.students} student${course.students === 1 ? "" : "s"} joined`}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-paper/65">
              A backup to groups: students can also type this code on their dashboard.{" "}
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
              With the connector set up, it drafts weeks, lessons, quizzes and exams for you to check. Try:
            </p>
            <p className="mt-3 -rotate-1 rounded-2xl bg-paper px-4 py-3 font-hand text-[1.25rem] leading-tight text-ink">
              “Turn my syllabus into weeks for ‘{course.title}’, with a lesson and a quiz each.”
            </p>
            <p className="mt-2 rotate-1 rounded-2xl bg-paper/70 px-4 py-3 font-hand text-[1.15rem] leading-tight text-ink">
              “Write a lesson on CSS selectors for Week 3, with examples and a quick check.”
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
      return "Draft course: students can’t find it yet. Publish it when it’s ready. Each week, quiz and exam inside is published separately, so students only ever see what you’ve released.";
    case "published":
      return "Published: students can find this course. Weeks, quizzes and exams still stay hidden until you publish each one.";
    case "archived":
      return "Archived: hidden from students and read-only.";
  }
}
