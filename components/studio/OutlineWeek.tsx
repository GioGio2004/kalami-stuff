"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { FormError } from "@/components/ui/form";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  Dots,
  LinkChain,
  Notebook,
  Pen,
  Plus,
  Robot,
  Trash,
} from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { AssessmentRow, compactSelectClass } from "./AssessmentRow";
import { DriveMark, driveBusy, folderStatus } from "./DriveStatus";
import type { Assessment, AssessmentId, LessonId, OutlineWeek, WeekId, WeekLink } from "./types";

/** What a week card can do; the outline fills these in (dialogs) or passes them through (mutations). */
export type WeekCardActions = {
  onEdit: () => void;
  onRemove: () => void;
  onPublish: () => Promise<void>;
  /** Publishing also publishes draft lessons and shares the folder; this asks first. */
  onConfirmPublish: () => void;
  onUnpublish: () => Promise<void>;
  onMove: (direction: "up" | "down") => Promise<void>;
  onNewLesson: () => void;
  onMoveLesson: (lessonId: LessonId, direction: "up" | "down") => Promise<void>;
  onAddLink: () => void;
  onEditLink: (link: WeekLink) => void;
  onRemoveLink: (linkId: string) => Promise<void>;
  onMoveLink: (linkId: string, direction: "up" | "down") => Promise<void>;
  onAddFolder: () => Promise<void>;
  onRetryDrive: () => Promise<void>;
  onNewAssessment: (kind: "quiz" | "task") => void;
  onPlace: (assessmentId: AssessmentId, weekId: WeekId | null) => Promise<void>;
};

export type MoveTarget = { value: WeekId | null; label: string };

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-ink disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** One week of the outline: its header (title, status, publish, menu) and, when open, lessons, materials and assessments. */
export function WeekCard({
  week,
  index,
  total,
  courseId,
  canEdit,
  driveUsable,
  open,
  onToggle,
  moveTargets,
  actions,
}: {
  week: OutlineWeek;
  index: number;
  total: number;
  courseId: string;
  canEdit: boolean;
  /** The viewer may create a Drive folder for it. */
  driveUsable: boolean;
  open: boolean;
  onToggle: () => void;
  /** Where its tasks and quizzes may go: the other weeks and Unplaced. */
  moveTargets: MoveTarget[];
  actions: WeekCardActions;
}) {
  const bodyId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const published = week.status === "published";
  const syncing = driveBusy(week.drive);
  const removable = !published && !week.drive?.shared && !syncing;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const materials = week.links.length + (week.drive ? 1 : 0);
  const summary = [
    count(week.lessons.length, "lesson"),
    count(materials, "material"),
    count(week.assessments.length, "task or quiz", "tasks and quizzes"),
  ].join(" · ");

  return (
    <article id={`week-${week._id}`} className="scroll-mt-28 rounded-[2rem] bg-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3 p-4 sm:p-5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 basis-60 items-start gap-3 rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-full text-base font-semibold tabular-nums ${
              published ? "bg-ink text-highlighter" : "bg-panel text-ink"
            }`}
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-lg font-medium leading-snug tracking-tight">{week.title}</span>
              <Pill tone={published ? "lime" : "panel"}>{published ? "Published" : "Draft"}</Pill>
            </span>
            <span className="mt-1 block text-sm text-graphite">
              <span className={published ? "text-ok" : ""}>
                {published ? "Students see this week" : canEdit ? "Only you see this" : "Hidden from students"}
              </span>
              <span aria-hidden> · </span>
              {summary}
            </span>
          </span>
          <ChevronDown
            className={`mt-3 size-5 shrink-0 text-graphite transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            {published ? (
              <Button size="sm" variant="ghost" disabled={busy || syncing} onClick={() => run(actions.onUnpublish)}>
                Unpublish
              </Button>
            ) : (
              <Button
                size="sm"
                variant="lime"
                disabled={busy || syncing}
                onClick={() => {
                  const sideEffects =
                    week.lessons.some((l) => l.status === "draft") || (week.drive?.url !== undefined && !week.drive.shared);
                  if (sideEffects) {
                    actions.onConfirmPublish();
                  } else {
                    void run(actions.onPublish);
                  }
                }}
              >
                Publish
              </Button>
            )}
            <Menu
              label={`More actions for ${week.title}`}
              buttonClassName="grid size-9 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-ink"
              items={[
                { label: "Edit title and description", icon: <Pen className="size-4" />, onSelect: actions.onEdit },
                {
                  label: "Move up",
                  icon: <ArrowUp className="size-4" />,
                  disabled: index === 0,
                  onSelect: () => void run(() => actions.onMove("up")),
                },
                {
                  label: "Move down",
                  icon: <ArrowDown className="size-4" />,
                  disabled: index === total - 1,
                  onSelect: () => void run(() => actions.onMove("down")),
                },
                {
                  label: "Remove…",
                  icon: <Trash className="size-4" />,
                  danger: true,
                  disabled: !removable,
                  description: removable
                    ? undefined
                    : syncing
                      ? "Wait for Google Drive to finish."
                      : "Unpublish it first, so students stop seeing it.",
                  onSelect: actions.onRemove,
                },
              ]}
            >
              <Dots className="size-5" />
            </Menu>
          </div>
        )}
        {error && (
          <div className="w-full">
            <FormError>{error}</FormError>
          </div>
        )}
      </div>

      {open && (
        <div id={bodyId} className="space-y-6 border-t border-line px-4 pb-5 pt-4 sm:px-5 sm:pb-6">
          {week.description && <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">{week.description}</p>}

          <Subsection
            title="Lessons"
            count={week.lessons.length}
            action={
              canEdit && (
                <Button size="sm" variant={week.lessons.length === 0 ? "outline" : "ghost"} onClick={actions.onNewLesson}>
                  <Plus className="size-4" />
                  Lesson
                </Button>
              )
            }
          >
            {week.lessons.length === 0 ? (
              <Empty>
                {canEdit
                  ? "No lessons yet. Write one here in blocks (text, code, images, quick checks), or ask your agent."
                  : "No lessons yet."}
              </Empty>
            ) : (
              <ul className="space-y-2">
                {week.lessons.map((lesson, i) => (
                  <li key={lesson._id} className="flex items-center gap-1">
                    <Link
                      href={`/courses/${courseId}/lessons/${lesson._id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 transition hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-highlighter/60">
                        <Notebook className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 break-words font-medium">{lesson.title}</span>
                          <Pill tone={statusTone(lesson.status)}>{statusLabel(lesson.status)}</Pill>
                          {lesson.createdVia === "mcp" && (
                            <Pill tone="lime">
                              <Robot className="size-3.5" />
                              Agent
                            </Pill>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-graphite">{count(lesson.blockCount, "block")}</span>
                      </span>
                      <ArrowRight className="size-5 shrink-0 text-graphite" />
                    </Link>
                    {canEdit && week.lessons.length > 1 && (
                      <span className="flex flex-col">
                        <button
                          type="button"
                          aria-label={`Move “${lesson.title}” up`}
                          disabled={i === 0 || busy}
                          className={iconButton}
                          onClick={() => run(() => actions.onMoveLesson(lesson._id, "up"))}
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move “${lesson.title}” down`}
                          disabled={i === week.lessons.length - 1 || busy}
                          className={iconButton}
                          onClick={() => run(() => actions.onMoveLesson(lesson._id, "down"))}
                        >
                          <ArrowDown className="size-4" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Subsection>

          <Subsection
            title="Materials"
            count={materials}
            action={
              canEdit && (
                <span className="flex flex-wrap gap-1.5">
                  {driveUsable && week.drive === null && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(actions.onAddFolder)}>
                      <Plus className="size-4" />
                      Drive folder
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={actions.onAddLink}>
                    <Plus className="size-4" />
                    Link
                  </Button>
                </span>
              )
            }
          >
            {materials === 0 ? (
              <Empty>
                {canEdit ? "No materials yet. Add links to slides, readings or videos." : "No materials yet."}
              </Empty>
            ) : (
              <ul className="space-y-2">
                {week.drive && (
                  <li>
                    <FolderRow week={week} canEdit={canEdit} busy={busy} onRetry={() => run(actions.onRetryDrive)} />
                  </li>
                )}
                {week.links.map((link, i) => (
                  <li key={link.id}>
                    <LinkRow
                      link={link}
                      canEdit={canEdit}
                      first={i === 0}
                      last={i === week.links.length - 1}
                      busy={busy}
                      onEdit={() => actions.onEditLink(link)}
                      onMove={(direction) => run(() => actions.onMoveLink(link.id, direction))}
                      onRemove={() => run(() => actions.onRemoveLink(link.id))}
                    />
                  </li>
                ))}
              </ul>
            )}
            {published && week.drive?.shared && (
              <p className="mt-2 text-xs leading-relaxed text-graphite">
                Anything you add to this week&apos;s Drive folder is visible to students straight away.
              </p>
            )}
          </Subsection>

          <Subsection
            title="Tasks & quizzes"
            count={week.assessments.length}
            action={
              canEdit && (
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => actions.onNewAssessment("quiz")}>
                    <Plus className="size-4" />
                    Quiz
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => actions.onNewAssessment("task")}>
                    <Plus className="size-4" />
                    Task
                  </Button>
                </span>
              )
            }
          >
            {week.assessments.length === 0 ? (
              <Empty>No tasks or quizzes in this week.</Empty>
            ) : (
              <ul className="space-y-2">
                {week.assessments.map((assessment) => (
                  <li key={assessment._id}>
                    <AssessmentRow
                      assessment={assessment}
                      courseId={courseId}
                      aside={
                        canEdit && moveTargets.length > 0 ? (
                          <MoveToSelect
                            assessment={assessment}
                            targets={moveTargets}
                            disabled={busy}
                            onPick={(weekId) => run(() => actions.onPlace(assessment._id, weekId))}
                          />
                        ) : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Subsection>
        </div>
      )}
    </article>
  );
}

function Subsection({
  title,
  count: n,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-graphite">
          {title}
          <span className="ml-1.5 tabular-nums text-graphite/70">{n}</span>
        </h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-graphite">{children}</p>;
}

function FolderRow({
  week,
  canEdit,
  busy,
  onRetry,
}: {
  week: OutlineWeek;
  canEdit: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  const drive = week.drive!;
  const status = folderStatus(drive, week.status);
  const working = driveBusy(drive);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-paper px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
        <DriveMark className="size-6" />
      </span>
      <span className="min-w-0 flex-1 basis-44">
        <span className="block font-medium">Google Drive folder</span>
        <span
          role={status.problem ? "alert" : undefined}
          className={`mt-0.5 flex items-center gap-1.5 text-xs ${status.problem ? "text-red-pen" : "text-graphite"}`}
        >
          {working && <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-highlighter-deep" />}
          {status.text}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {canEdit && (drive.error !== undefined || drive.stale) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
        )}
        {drive.url && (
          <a
            href={drive.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium transition hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Open folder
            <ArrowUpRight className="size-4" />
          </a>
        )}
      </span>
    </div>
  );
}

function LinkRow({
  link,
  canEdit,
  first,
  last,
  busy,
  onEdit,
  onMove,
  onRemove,
}: {
  link: WeekLink;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  busy: boolean;
  onEdit: () => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-paper py-2.5 pl-4 pr-2">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
        <LinkChain className="size-5" />
      </span>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group min-w-0 flex-1 basis-40 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="flex items-center gap-1 break-words font-medium group-hover:underline group-hover:underline-offset-4">
          <span className="min-w-0 break-words">{link.title}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-graphite" />
        </span>
        <span className="block truncate text-xs text-graphite">{hostOf(link.url)}</span>
      </a>
      {canEdit &&
        (confirming ? (
          <span className="ml-auto flex flex-wrap items-center gap-1 text-sm">
            <span className="px-1 text-graphite">Remove this link?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              Remove
            </Button>
          </span>
        ) : (
          <span className="ml-auto flex items-center">
            <button type="button" aria-label={`Move “${link.title}” up`} disabled={first || busy} className={iconButton} onClick={() => onMove("up")}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" aria-label={`Move “${link.title}” down`} disabled={last || busy} className={iconButton} onClick={() => onMove("down")}>
              <ArrowDown className="size-4" />
            </button>
            <button type="button" aria-label={`Edit “${link.title}”`} className={iconButton} onClick={onEdit}>
              <Pen className="size-4" />
            </button>
            <button type="button" aria-label={`Remove “${link.title}”`} className={iconButton} onClick={() => setConfirming(true)}>
              <Trash className="size-4" />
            </button>
          </span>
        ))}
    </div>
  );
}

/** "Move to…": puts a task or quiz in another week, or among the unplaced. Resets after each pick. */
export function MoveToSelect({
  assessment,
  targets,
  disabled,
  onPick,
}: {
  assessment: Assessment;
  targets: MoveTarget[];
  disabled?: boolean;
  onPick: (weekId: WeekId | null) => void;
}) {
  return (
    <div className="relative inline-flex max-w-full">
      <select
        aria-label={`Move “${assessment.title}” to another week`}
        value=""
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "") return;
          onPick(value === UNPLACED ? null : (value as WeekId));
        }}
        className={`${compactSelectClass} w-full appearance-none sm:w-auto sm:max-w-56`}
      >
        <option value="" disabled>
          Move to…
        </option>
        {targets.map((target) => (
          <option key={target.value ?? UNPLACED} value={target.value ?? UNPLACED}>
            {target.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-graphite" />
    </div>
  );
}

const UNPLACED = "__unplaced";

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
