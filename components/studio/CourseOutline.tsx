"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { CheckCard, Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { ArrowRight, Plus } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";
import { AssessmentRow } from "./AssessmentRow";
import { canUseDrive, DriveStrip } from "./DriveStatus";
import { MoveToSelect, WeekCard, type MoveTarget } from "./OutlineWeek";
import {
  KIND_LABEL,
  type AssessmentId,
  type AssessmentKind,
  type CourseOutline as CourseOutlineData,
  type DriveConnection,
  type LessonId,
  type OutlineWeek,
  type WeekId,
  type WeekLink,
} from "./types";

export type OutlineActions = {
  onConnectDrive: () => Promise<void>;
  /** The Drive owner is gone: new folders in the viewer's own Drive. */
  onMoveToMyDrive: () => Promise<void>;
  onCreateWeek: (args: { title?: string; description?: string; driveFolder?: boolean }) => Promise<void>;
  onUpdateWeek: (weekId: WeekId, patch: { title?: string; description?: string }) => Promise<void>;
  onMoveWeek: (weekId: WeekId, direction: "up" | "down") => Promise<void>;
  onPublishWeek: (weekId: WeekId) => Promise<void>;
  onUnpublishWeek: (weekId: WeekId) => Promise<void>;
  onRemoveWeek: (weekId: WeekId) => Promise<void>;
  onAddLink: (weekId: WeekId, link: { title: string; url: string }) => Promise<void>;
  onUpdateLink: (weekId: WeekId, linkId: string, link: { title: string; url: string }) => Promise<void>;
  onRemoveLink: (weekId: WeekId, linkId: string) => Promise<void>;
  onMoveLink: (weekId: WeekId, linkId: string, direction: "up" | "down") => Promise<void>;
  onAddFolder: (weekId: WeekId) => Promise<void>;
  onRetryDrive: (weekId: WeekId) => Promise<void>;
  /** Creates a draft lesson; the page then opens its editor. */
  onCreateLesson: (weekId: WeekId, title: string) => Promise<void>;
  onMoveLesson: (lessonId: LessonId, direction: "up" | "down") => Promise<void>;
  /** Creates a draft assessment (tasks and quizzes in a week); the page then opens the builder. */
  onCreateAssessment: (args: { kind: AssessmentKind; title: string; weekId?: WeekId }) => Promise<void>;
  onPlace: (assessmentId: AssessmentId, weekId: WeekId | null) => Promise<void>;
};

type Dialogs =
  | { kind: "new-week" }
  | { kind: "edit-week"; week: OutlineWeek }
  | { kind: "remove-week"; week: OutlineWeek }
  | { kind: "publish-week"; week: OutlineWeek }
  | { kind: "new-lesson"; week: OutlineWeek }
  | { kind: "link"; week: OutlineWeek; link?: WeekLink }
  | { kind: "new-assessment"; assessmentKind: AssessmentKind; week?: OutlineWeek };

const KIND_BLURB: Record<AssessmentKind, string> = {
  task: "Homework in the code sandbox: HTML and CSS in small steps, checked as students type. Best drafted by your agent.",
  quiz: "A short check on the week's topic. Standard integrity, results after close.",
  midterm: "The mid-semester exam. Strict integrity and a 60-minute timer by default.",
  final: "The end-of-semester exam. Strict integrity and a 90-minute timer by default.",
};

/**
 * The course, week by week. Each week holds lessons written in Kalami,
 * materials (a Google Drive folder and links), and its tasks and quizzes.
 * Midterms and finals sit in Exams; tasks and quizzes not in a week yet sit
 * in Unplaced. Students see a week once it's published.
 */
export function CourseOutline({
  data,
  connection,
  actions,
  locale = "en",
}: {
  data: CourseOutlineData | undefined;
  /** Undefined while it's being checked. */
  connection: DriveConnection | undefined;
  actions: OutlineActions;
  /** The course's language; new weeks are called "Week N" in it. */
  locale?: "ka" | "en";
}) {
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  const hash = useLocationHash();
  const scrolledTo = useRef<string | null>(null);
  const ready = data !== undefined;

  // Back from a lesson (its breadcrumb links to #week-…): bring that week into view.
  useEffect(() => {
    if (!ready || !hash.startsWith("#week-") || scrolledTo.current === hash) return;
    scrolledTo.current = hash;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);

  if (data === undefined) {
    return <section className="rounded-[2rem] bg-card p-5 text-graphite sm:p-6">Loading the course outline…</section>;
  }

  const { canEdit, weeks, exams, unplaced } = data;
  const courseId = data.courseId;
  const driveUsable = canUseDrive(data, connection);
  const lastPublished = [...weeks].reverse().find((w) => w.status === "published")?._id;
  const isOpen = (week: OutlineWeek) =>
    openWeeks[week._id] ?? (week.status === "draft" || week._id === lastPublished || hash === `#week-${week._id}`);
  const allOpen = weeks.every(isOpen);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const weekTargets = weeks.map<MoveTarget>((w) => ({ value: w._id, label: w.title }));

  return (
    <div className="space-y-4">
      <section className="rounded-[2rem] bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-medium tracking-tight">
              Course outline
              <span className="ml-2 text-base font-normal text-graphite">
                {weeks.length} week{weeks.length === 1 ? "" : "s"}
              </span>
            </h2>
            <p className="mt-0.5 max-w-xl text-sm text-graphite">
              Week by week: lessons, materials, tasks and quizzes. Students see a week once you publish it.
            </p>
          </div>
          {canEdit && (
            <Button size="sm" variant={weeks.length === 0 ? "ink" : "outline"} onClick={() => setDialog({ kind: "new-week" })}>
              <Plus className="size-4" />
              New week
            </Button>
          )}
        </div>
        {canEdit && (
          <div className="mt-4">
            <DriveStrip
              data={data}
              connection={connection}
              connecting={connecting}
              onMoveToMyDrive={() => run(actions.onMoveToMyDrive)}
              onConnect={async () => {
                setConnecting(true);
                setError(null);
                try {
                  await actions.onConnectDrive();
                } catch (caught) {
                  setError(errorMessage(caught));
                  setConnecting(false);
                }
              }}
            />
          </div>
        )}
        {error && (
          <div className="mt-4">
            <FormError>{error}</FormError>
          </div>
        )}
        {weeks.length > 1 && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpenWeeks(Object.fromEntries(weeks.map((w) => [w._id, !allOpen])))}
              className="rounded-full px-2 py-1 text-sm text-graphite underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink"
            >
              {allOpen ? "Collapse all weeks" : "Expand all weeks"}
            </button>
          </div>
        )}
      </section>

      {weeks.length === 0 ? (
        <EmptyOutline canEdit={canEdit} onNewWeek={() => setDialog({ kind: "new-week" })} />
      ) : (
        <ol className="space-y-3" aria-label="Weeks">
          {weeks.map((week, index) => (
            <li key={week._id}>
              <WeekCard
                week={week}
                index={index}
                total={weeks.length}
                courseId={courseId}
                canEdit={canEdit}
                driveUsable={driveUsable}
                open={isOpen(week)}
                onToggle={() => setOpenWeeks((current) => ({ ...current, [week._id]: !isOpen(week) }))}
                moveTargets={[...weekTargets.filter((t) => t.value !== week._id), { value: null, label: "Unplaced" }]}
                actions={{
                  onEdit: () => setDialog({ kind: "edit-week", week }),
                  onRemove: () => setDialog({ kind: "remove-week", week }),
                  onPublish: () => actions.onPublishWeek(week._id),
                  onConfirmPublish: () => setDialog({ kind: "publish-week", week }),
                  onUnpublish: () => actions.onUnpublishWeek(week._id),
                  onMove: (direction) => actions.onMoveWeek(week._id, direction),
                  onNewLesson: () => setDialog({ kind: "new-lesson", week }),
                  onMoveLesson: actions.onMoveLesson,
                  onAddLink: () => setDialog({ kind: "link", week }),
                  onEditLink: (link) => setDialog({ kind: "link", week, link }),
                  onRemoveLink: (linkId) => actions.onRemoveLink(week._id, linkId),
                  onMoveLink: (linkId, direction) => actions.onMoveLink(week._id, linkId, direction),
                  onAddFolder: () => actions.onAddFolder(week._id),
                  onRetryDrive: () => actions.onRetryDrive(week._id),
                  onNewAssessment: (assessmentKind) => setDialog({ kind: "new-assessment", assessmentKind, week }),
                  onPlace: actions.onPlace,
                }}
              />
            </li>
          ))}
        </ol>
      )}

      <section className="rounded-[2rem] bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-medium tracking-tight">
              Exams
              <span className="ml-2 text-base font-normal text-graphite">{exams.length}</span>
            </h2>
            <p className="mt-0.5 max-w-xl text-sm text-graphite">
              Midterms and finals sit outside the weeks. Strict integrity and a timer by default.
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "new-assessment", assessmentKind: "midterm" })}>
                <Plus className="size-4" />
                Midterm
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "new-assessment", assessmentKind: "final" })}>
                <Plus className="size-4" />
                Final
              </Button>
            </div>
          )}
        </div>
        {exams.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {exams.map((assessment) => (
              <li key={assessment._id}>
                <AssessmentRow assessment={assessment} courseId={courseId} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-graphite">No exams yet.</p>
        )}
      </section>

      {unplaced.length > 0 && (
        <section className="rounded-[2rem] border-2 border-dashed border-ink/15 p-5 sm:p-6">
          <h2 className="text-xl font-medium tracking-tight">
            Unplaced
            <span className="ml-2 text-base font-normal text-graphite">{unplaced.length}</span>
          </h2>
          <p className="mt-0.5 max-w-xl text-sm text-graphite">
            {canEdit
              ? weeks.length > 0
                ? "Put these in a week so students find them in the right place."
                : "Put these in a week so students find them in the right place. Add a week first."
              : "Tasks and quizzes that aren't in a week yet."}
          </p>
          <ul className="mt-4 space-y-2">
            {unplaced.map((assessment) => (
              <li key={assessment._id}>
                <AssessmentRow
                  assessment={assessment}
                  courseId={courseId}
                  aside={
                    canEdit && weekTargets.length > 0 ? (
                      <MoveToSelect
                        assessment={assessment}
                        targets={weekTargets}
                        onPick={(weekId) => run(() => actions.onPlace(assessment._id, weekId))}
                      />
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} label={dialogLabel(dialog)}>
        {dialog && (
          <OutlineDialog
            dialog={dialog}
            weekCount={weeks.length}
            locale={locale}
            driveUsable={driveUsable}
            driveDefault={data.drive?.mine === true}
            actions={actions}
            onDone={() => setDialog(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function EmptyOutline({ canEdit, onNewWeek }: { canEdit: boolean; onNewWeek: () => void }) {
  return (
    <section className="rounded-[2rem] border-2 border-dashed border-ink/15 px-6 py-10 text-center sm:py-12">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A fresh notebook</p>
      <h3 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">Plan your course week by week</h3>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-graphite">
        {canEdit
          ? "Each week holds lessons you write here, slides and links, and that week's tasks and quizzes. Publish a week when it's ready."
          : "No weeks yet."}
      </p>
      {canEdit && (
        <>
          <Button className="mt-6" onClick={onNewWeek}>
            <Plus className="size-4" />
            New week
          </Button>
          <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-graphite">
            Have a syllabus? Your AI assistant can draft the whole outline, with lessons and a quiz for each week.{" "}
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 font-medium text-ink underline-offset-4 hover:underline"
            >
              Set up your agent
              <ArrowRight className="size-3.5" />
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

function dialogLabel(dialog: Dialogs | null): string {
  switch (dialog?.kind) {
    case "new-week":
      return "New week";
    case "edit-week":
      return "Edit week";
    case "remove-week":
      return "Remove week";
    case "publish-week":
      return "Publish week";
    case "new-lesson":
      return "New lesson";
    case "link":
      return dialog.link ? "Edit link" : "Add a link";
    case "new-assessment":
      return `New ${KIND_LABEL[dialog.assessmentKind].toLowerCase()}`;
    default:
      return "Course outline";
  }
}

// --- Dialogs ----------------------------------------------------------------------------

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

function OutlineDialog({
  dialog,
  weekCount,
  locale,
  driveUsable,
  driveDefault,
  actions,
  onDone,
}: {
  dialog: Dialogs;
  weekCount: number;
  locale: "ka" | "en";
  driveUsable: boolean;
  driveDefault: boolean;
  actions: OutlineActions;
  onDone: () => void;
}) {
  switch (dialog.kind) {
    case "new-week":
      return (
        <WeekForm
          placeholder={locale === "ka" ? `კვირა ${weekCount + 1}` : `Week ${weekCount + 1}`}
          driveUsable={driveUsable}
          driveDefault={driveDefault}
          onSubmit={async (values) => {
            await actions.onCreateWeek({
              title: values.title.trim() || undefined,
              description: values.description.trim() || undefined,
              driveFolder: driveUsable && values.driveFolder ? true : undefined,
            });
            onDone();
          }}
          onCancel={onDone}
        />
      );
    case "edit-week":
      return (
        <WeekForm
          week={dialog.week}
          onSubmit={async (values) => {
            await actions.onUpdateWeek(dialog.week._id, { title: values.title, description: values.description });
            onDone();
          }}
          onCancel={onDone}
        />
      );
    case "remove-week":
      return <RemoveWeek week={dialog.week} onRemove={() => actions.onRemoveWeek(dialog.week._id).then(onDone)} onCancel={onDone} />;
    case "publish-week":
      return <PublishWeek week={dialog.week} onPublish={() => actions.onPublishWeek(dialog.week._id).then(onDone)} onCancel={onDone} />;
    case "new-lesson":
      return (
        <TitleForm
          hand="A blank page"
          heading="New lesson"
          blurb={`It goes into “${dialog.week.title}” as a draft, and the editor opens next: write it in blocks (text, tips, code, images, video, steps and quick checks).`}
          label="Lesson title"
          placeholder="Selecting elements with CSS"
          maxLength={160}
          submitLabel="Create and open"
          onSubmit={async (title) => {
            await actions.onCreateLesson(dialog.week._id, title);
            onDone();
          }}
          onCancel={onDone}
        />
      );
    case "link":
      return (
        <LinkForm
          week={dialog.week}
          link={dialog.link}
          onSubmit={async (values) => {
            if (dialog.link) {
              await actions.onUpdateLink(dialog.week._id, dialog.link.id, values);
            } else {
              await actions.onAddLink(dialog.week._id, values);
            }
            onDone();
          }}
          onCancel={onDone}
        />
      );
    case "new-assessment": {
      const { assessmentKind, week } = dialog;
      const label = KIND_LABEL[assessmentKind].toLowerCase();
      return (
        <TitleForm
          hand="A blank one"
          heading={`New ${label}`}
          blurb={`${KIND_BLURB[assessmentKind]}${week ? ` It goes into “${week.title}”.` : ""} You can change every setting afterwards.`}
          label="Title"
          placeholder={
            assessmentKind === "quiz"
              ? `${week?.title ?? "Week 3"} · Quick check`
              : assessmentKind === "task"
                ? "Build a profile card"
                : `${KIND_LABEL[assessmentKind]} · Spring 2026`
          }
          maxLength={160}
          submitLabel="Create draft"
          onSubmit={async (title) => {
            await actions.onCreateAssessment({ kind: assessmentKind, title, weekId: week?._id });
            onDone();
          }}
          onCancel={onDone}
        />
      );
    }
  }
}

function DialogFooter({
  busy,
  error,
  onCancel,
  cancelLabel = "Cancel",
  children,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  cancelLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        {children}
      </div>
    </>
  );
}

function WeekForm({
  week,
  placeholder,
  driveUsable = false,
  driveDefault = false,
  onSubmit,
  onCancel,
}: {
  /** Editing this week; otherwise a new one. */
  week?: OutlineWeek;
  placeholder?: string;
  driveUsable?: boolean;
  driveDefault?: boolean;
  onSubmit: (values: { title: string; description: string; driveFolder: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(week?.title ?? "");
  const [description, setDescription] = useState(week?.description ?? "");
  const [driveFolder, setDriveFolder] = useState(driveDefault);
  const { busy, error, submit } = useSubmit();

  function save(event: FormEvent) {
    event.preventDefault();
    void submit(() => onSubmit({ title, description, driveFolder }));
  }

  return (
    <form onSubmit={save} className="p-6 sm:p-10">
      {!week && <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">One more week</p>}
      <h2 className={`${week ? "" : "mt-3 "}text-3xl font-medium tracking-[-0.03em]`}>{week ? "Edit week" : "New week"}</h2>
      {!week && (
        <p className="mt-2 text-[15px] text-graphite">
          It starts as a draft: only you see it until you publish it. Add lessons, materials, tasks and quizzes to it next.
        </p>
      )}
      <div className="mt-6 space-y-5">
        <Field
          label="Title"
          htmlFor="week-title"
          optional={!week}
          hint={week ? undefined : `Leave it empty for “${placeholder}”, or name the topic: “Unit 2 · Forms”.`}
        >
          <TextInput
            id="week-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={placeholder}
            maxLength={120}
            autoFocus
            required={week !== undefined}
          />
        </Field>
        <Field label="Note for students" htmlFor="week-description" optional>
          <TextArea
            id="week-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="What this week covers. Read chapter 2 before Thursday."
          />
        </Field>
        {driveUsable && !week && (
          <CheckCard checked={driveFolder} onChange={setDriveFolder}>
            Also create a Google Drive folder
            <span className="mt-0.5 block text-sm font-normal text-graphite">
              A private folder for this week&apos;s slides and files. It&apos;s shared by link when you publish the week.
            </span>
          </CheckCard>
        )}
      </div>
      <DialogFooter busy={busy} error={error} onCancel={onCancel}>
        <Button type="submit" disabled={busy || (week !== undefined && title.trim() === "")}>
          {week ? "Save" : "Add week"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LinkForm({
  week,
  link,
  onSubmit,
  onCancel,
}: {
  week: OutlineWeek;
  link?: WeekLink;
  onSubmit: (values: { title: string; url: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const { busy, error, submit } = useSubmit();

  function save(event: FormEvent) {
    event.preventDefault();
    void submit(() => onSubmit({ title, url }));
  }

  return (
    <form onSubmit={save} className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">{link ? "Edit link" : "Add a link"}</h2>
      {!link && (
        <p className="mt-2 text-[15px] text-graphite">
          Slides, a reading, a video or a playlist for “{week.title}”: anything with an https:// address. Students open it
          in a new tab, so make sure they can (OneDrive and Dropbox links need sharing on).
        </p>
      )}
      <div className="mt-6 space-y-5">
        <Field label="Title" htmlFor="link-title">
          <TextInput
            id="link-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Slides · CSS selectors"
            maxLength={120}
            autoFocus
            required
          />
        </Field>
        <Field label="Link" htmlFor="link-url">
          <TextInput
            id="link-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            maxLength={2000}
            required
          />
        </Field>
      </div>
      <DialogFooter busy={busy} error={error} onCancel={onCancel}>
        <Button type="submit" disabled={busy || title.trim() === "" || url.trim() === ""}>
          {link ? "Save" : "Add link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TitleForm({
  hand,
  heading,
  blurb,
  label,
  placeholder,
  maxLength,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  hand: string;
  heading: string;
  blurb: string;
  label: string;
  placeholder: string;
  maxLength: number;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const { busy, error, submit } = useSubmit();

  function save(event: FormEvent) {
    event.preventDefault();
    void submit(() => onSubmit(title));
  }

  return (
    <form onSubmit={save} className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">{hand}</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">{heading}</h2>
      <p className="mt-2 text-[15px] text-graphite">{blurb}</p>
      <div className="mt-6">
        <Field label={label} htmlFor="outline-title">
          <TextInput
            id="outline-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
            required
          />
        </Field>
      </div>
      <DialogFooter busy={busy} error={error} onCancel={onCancel}>
        <Button type="submit" disabled={busy || title.trim() === ""}>
          {busy ? "Creating…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RemoveWeek({ week, onRemove, onCancel }: { week: OutlineWeek; onRemove: () => Promise<void>; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit();
  const lessons = week.lessons.length;
  const placed = week.assessments.length;
  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Remove “{week.title}”?</h2>
      {lessons === 0 && placed === 0 && !week.drive ? (
        <p className="mt-4 text-[15px] leading-relaxed text-graphite">
          It&apos;s empty{week.links.length > 0 ? " apart from its links" : ""}, so nothing else is affected.
        </p>
      ) : (
        <ul className="mt-4 space-y-2 text-[15px] leading-relaxed">
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-red-pen" />
            {lessons === 0
              ? "It has no lessons."
              : `Its ${lessons === 1 ? "lesson is" : `${lessons} lessons are`} deleted. This can’t be undone.`}
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
            {placed === 0
              ? "It has no tasks or quizzes."
              : `Its ${placed === 1 ? "task or quiz becomes" : `${placed} tasks and quizzes become`} unplaced. Nothing in them is deleted.`}
          </li>
          {week.drive && (
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
              Its Drive folder stays in your Google Drive, with everything in it.
            </li>
          )}
        </ul>
      )}
      <DialogFooter busy={busy} error={error} onCancel={onCancel} cancelLabel="Keep it">
        <Button variant="danger" disabled={busy} onClick={() => void submit(onRemove)}>
          {busy ? "Removing…" : "Remove week"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function PublishWeek({ week, onPublish, onCancel }: { week: OutlineWeek; onPublish: () => Promise<void>; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit();
  const drafts = week.lessons.filter((l) => l.status === "draft").length;
  const empty = week.lessons.filter((l) => l.status === "draft" && l.blockCount === 0);
  const sharing = week.drive?.url !== undefined && !week.drive.shared;
  return (
    <div className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">Ready for class?</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">Publish “{week.title}”?</h2>
      <p className="mt-3 text-[15px] text-graphite">Students in this course will see the week, with:</p>
      <ul className="mt-3 space-y-2 text-[15px] leading-relaxed">
        {drafts > 0 && (
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-highlighter-deep" />
            {drafts === 1 ? "its draft lesson, published along with it" : `its ${drafts} draft lessons, published along with it`}
          </li>
        )}
        {week.links.length > 0 && (
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-highlighter-deep" />
            {week.links.length === 1 ? "its link" : `its ${week.links.length} links`}
          </li>
        )}
        {sharing && (
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-highlighter-deep" />
            its Drive folder, shared so anyone with the link can view it
          </li>
        )}
      </ul>
      {empty.length > 0 && (
        <p className="mt-3 rounded-2xl bg-highlighter/40 px-4 py-3 text-sm leading-relaxed">
          {empty.length === 1 ? `“${empty[0].title}” is still empty` : `${empty.length} lessons are still empty`}:
          students would open a blank page. Write {empty.length === 1 ? "it" : "them"} first, or delete{" "}
          {empty.length === 1 ? "it" : "them"}.
        </p>
      )}
      <p className="mt-3 text-sm text-graphite">Tasks and quizzes in the week keep their own Publish button.</p>
      <DialogFooter busy={busy} error={error} onCancel={onCancel} cancelLabel="Not yet">
        <Button variant="lime" disabled={busy} onClick={() => void submit(onPublish)}>
          {busy ? "Publishing…" : "Publish week"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- The URL's #hash, read without effects ------------------------------------------------

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function useLocationHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
}
