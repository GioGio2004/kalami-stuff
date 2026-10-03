"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { Field, FormError, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/form";
import { errorMessage } from "@/lib/errors";
import type { CourseDetail, NewCourseArgs, UniversityOption } from "./types";

const LOCALES = [
  { value: "ka" as const, label: "ქართული" },
  { value: "en" as const, label: "English" },
];

/** Create or edit a course. `universities` is only shown when there's a choice. */
export function CourseForm({
  course,
  universities = [],
  defaultLocale = "ka",
  onSubmit,
  onCancel,
}: {
  course?: Pick<CourseDetail, "title" | "description" | "semester" | "locale">;
  universities?: UniversityOption[];
  defaultLocale?: "ka" | "en";
  onSubmit: (args: NewCourseArgs) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [semester, setSemester] = useState(course?.semester ?? "");
  const [locale, setLocale] = useState<"ka" | "en">(course?.locale ?? defaultLocale);
  // Empty until the person picks one; the list may still be loading when the form opens.
  const [pickedUniversityId, setUniversityId] = useState<string>("");
  const universityId = pickedUniversityId || universities[0]?._id || "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title,
        description: description || undefined,
        semester: semester || undefined,
        locale,
        universityId:
          !course && universities.length > 1 ? (universityId as UniversityOption["_id"]) : undefined,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Title" htmlFor="course-title">
        <TextInput
          id="course-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Web basics"
          maxLength={120}
          autoFocus
          required
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Semester" htmlFor="course-semester" optional>
          <TextInput
            id="course-semester"
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            placeholder="Spring 2026"
            maxLength={60}
          />
        </Field>
        <Field label="Language" hint="What the questions are written in. Agents write in it too.">
          <Segmented label="Language" value={locale} options={LOCALES} onChange={setLocale} />
        </Field>
      </div>
      {!course && universities.length > 1 && (
        <Field label="University" htmlFor="course-university" hint="The course belongs to this university for good.">

          <SelectInput id="course-university" value={universityId} onChange={(e) => setUniversityId(e.target.value)}>
            {universities.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name.en} · {u.name.ka}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <Field label="Description" htmlFor="course-description" optional hint="Students see this on the course page.">
        <TextArea
          id="course-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <div className="flex flex-wrap justify-end gap-3 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy || title.trim() === ""}>
          {course ? "Save changes" : "Create course"}
        </Button>
      </div>
    </form>
  );
}
