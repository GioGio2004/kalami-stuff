"use client";

import { useState } from "react";
import { KalamiFileIcon } from "@/components/kalami/KalamiFile";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { FormError, TextInput } from "@/components/ui/form";
import { errorMessage } from "@/lib/errors";
import type { CourseSummary } from "./types";

/**
 * Confirms deleting a course. A course students joined also asks for its join
 * code typed out, so a slip of the mouse can't take their work with it.
 */
export function DeleteCourse({
  course,
  onClose,
  onDelete,
  onExport,
}: {
  /** The course to delete; null keeps the dialog closed. */
  course: CourseSummary | null;
  onClose: () => void;
  onDelete: (courseId: CourseSummary["_id"]) => Promise<void>;
  /** Downloads the course as a .kalami file first. */
  onExport?: (courseId: CourseSummary["_id"]) => Promise<void>;
}) {
  return (
    <Dialog open={course !== null} onClose={onClose} label="Delete course">
      {course !== null && (
        <ConfirmDelete key={course._id} course={course} onClose={onClose} onDelete={onDelete} onExport={onExport} />
      )}
    </Dialog>
  );
}

function ConfirmDelete({
  course,
  onClose,
  onDelete,
  onExport,
}: {
  course: CourseSummary;
  onClose: () => void;
  onDelete: (courseId: CourseSummary["_id"]) => Promise<void>;
  onExport?: (courseId: CourseSummary["_id"]) => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"delete" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsCode = course.students > 0;
  const confirmed = !needsCode || typed.trim().toUpperCase() === course.joinCode;
  const { counts } = course;
  const assessments = counts.tasks + counts.quizzes + counts.midterms + counts.finals;

  async function run(kind: "delete" | "export", work: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="p-6 sm:p-10"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed && busy === null) void run("delete", () => onDelete(course._id));
      }}
    >
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-red-pen">For good</p>
      <h2 className="mt-3 pr-10 text-3xl font-medium tracking-[-0.03em]">Delete “{course.title}”?</h2>
      <ul className="mt-5 space-y-2 text-[15px] text-ink/85">
        <li>
          Everything in it goes: weeks, lessons, links
          {assessments > 0 ? `, ${assessments} assessment${assessments === 1 ? "" : "s"}` : ""} and every student’s
          answers and grades.
        </li>
        {course.students > 0 && (
          <li className="font-medium text-red-pen">
            {course.students} student{course.students === 1 ? "" : "s"} lose access right away.
          </li>
        )}
        <li className="text-graphite">Files in your Google Drive stay where they are. This can’t be undone.</li>
      </ul>

      {onExport && (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-3xl bg-panel p-4">
          <KalamiFileIcon className="h-12 w-auto" decorative />
          <p className="min-w-0 flex-1 text-sm text-graphite">
            Want a copy? A .kalami file brings the whole course back later.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => run("export", () => onExport(course._id))}
          >
            {busy === "export" ? "Saving…" : "Download .kalami"}
          </Button>
        </div>
      )}

      {needsCode && (
        <label className="mt-6 block">
          <span className="text-sm font-medium">
            Type the join code <span className="font-mono tracking-[0.14em]">{course.joinCode}</span> to confirm
          </span>
          <TextInput
            className="mt-2 font-mono uppercase tracking-[0.14em]"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${course.joinCode} to confirm`}
          />
        </label>
      )}

      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={busy === "delete"}>
          Keep it
        </Button>
        <Button type="submit" variant="danger" disabled={!confirmed || busy !== null}>
          {busy === "delete" ? "Deleting…" : "Delete course"}
        </Button>
      </div>
    </form>
  );
}
