"use client";

import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { ArrowDown, ArrowUp, ArrowUpRight, Notebook, Plus } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import type { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

export type CourseMaterialsData = FunctionReturnType<typeof api.materials.forCourse>;
export type MaterialWeek = CourseMaterialsData["weeks"][number];
export type DriveConnection = FunctionReturnType<typeof api.drive.connection>;
type WeekId = MaterialWeek["_id"];

export type MaterialsActions = {
  onConnectDrive: () => Promise<void>;
  onAddDrive: (args: { title: string; description?: string }) => Promise<void>;
  onAddLink: (args: { title: string; description?: string; url: string }) => Promise<void>;
  onUpdate: (materialId: WeekId, patch: { title?: string; description?: string; url?: string }) => Promise<void>;
  onMove: (materialId: WeekId, direction: "up" | "down") => Promise<void>;
  onPublish: (materialId: WeekId) => Promise<void>;
  onUnpublish: (materialId: WeekId) => Promise<void>;
  onRemove: (materialId: WeekId) => Promise<void>;
  onRetry: (materialId: WeekId) => Promise<void>;
  /** The Drive owner is gone: new folders in the viewer's own Drive. */
  onMoveToMyDrive: () => Promise<void>;
};

type Editing = { mode: "drive" } | { mode: "link" } | { mode: "edit"; week: MaterialWeek };

/**
 * Week-by-week materials. Files stay in the lecturer's Google Drive: Kalami
 * makes a private course folder with a folder per week, and publishing a week
 * shares just that folder by link. A week can also be a link to anywhere.
 */
export function CourseMaterials({
  data,
  connection,
  actions,
}: {
  data: CourseMaterialsData | undefined;
  /** Undefined while it's being checked. */
  connection: DriveConnection | undefined;
  actions: MaterialsActions;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (data === undefined) {
    return <section className="rounded-[2rem] bg-card p-5 text-graphite sm:p-6">Loading materials…</section>;
  }

  const othersDrive = data.drive !== null && !data.drive.mine;
  const canUseDrive = data.canEdit && data.driveAvailable && !othersDrive && connection?.connected === true;

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="rounded-[2rem] bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-tight">
            Materials
            <span className="ml-2 text-base font-normal text-graphite">{data.weeks.length}</span>
          </h2>
          <p className="mt-0.5 max-w-xl text-sm text-graphite">
            Slides, readings and files, week by week. Students see a week once you publish it.
          </p>
        </div>
        {data.canEdit && (
          <div className="flex flex-wrap gap-2">
            {canUseDrive && (
              <Button size="sm" variant={data.weeks.length === 0 ? "ink" : "outline"} onClick={() => setEditing({ mode: "drive" })}>
                <Plus className="size-4" />
                New week
              </Button>
            )}
            <Button size="sm" variant={canUseDrive || data.weeks.length > 0 ? "ghost" : "outline"} onClick={() => setEditing({ mode: "link" })}>
              <Plus className="size-4" />
              Add a link
            </Button>
          </div>
        )}
      </div>

      {data.canEdit && (
        <DriveStatus
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
      )}
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}

      {data.weeks.length > 0 && (
        <ol className="mt-4 space-y-2">
          {data.weeks.map((week, index) => (
            <li key={week._id}>
              <WeekRow
                week={week}
                canEdit={data.canEdit}
                first={index === 0}
                last={index === data.weeks.length - 1}
                onEdit={() => setEditing({ mode: "edit", week })}
                run={run}
                actions={actions}
              />
            </li>
          ))}
        </ol>
      )}
      {data.weeks.some((w) => w.source === "drive" && w.shared) && (
        <p className="mt-3 text-xs leading-relaxed text-graphite">
          Anything you add to a published week&apos;s folder is visible to students straight away, through Drive. Keep
          drafts for later weeks in their own unpublished week.
        </p>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} label="Materials week">
        {editing && (
          <WeekForm
            editing={editing}
            onSubmit={async (values) => {
              if (editing.mode === "drive") {
                await actions.onAddDrive({ title: values.title, description: values.description || undefined });
              } else if (editing.mode === "link") {
                await actions.onAddLink({ title: values.title, description: values.description || undefined, url: values.url });
              } else {
                await actions.onUpdate(editing.week._id, {
                  title: values.title,
                  description: values.description,
                  url: editing.week.source === "link" ? values.url : undefined,
                });
              }
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </section>
  );
}

function DriveStatus({
  data,
  connection,
  connecting,
  onConnect,
  onMoveToMyDrive,
}: {
  data: CourseMaterialsData;
  connection: DriveConnection | undefined;
  connecting: boolean;
  onConnect: () => void;
  onMoveToMyDrive: () => void;
}) {
  if (!data.driveAvailable) {
    return (
      <p className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">
        Google Drive isn&apos;t switched on for this Kalami server yet. You can add links to materials hosted anywhere.
      </p>
    );
  }
  if (data.drive !== null && !data.drive.mine) {
    return (
      <div className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">
        <p>
          This course&apos;s folders live in {data.drive.ownerName}&apos;s Google Drive, so only they can add Drive weeks or
          share them. You can still add links, and hide any week.
        </p>
        {data.drive.canTakeOver && connection?.connected && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={onMoveToMyDrive}>
              Move to my Drive
            </Button>
            <span className="text-xs">
              Kalami makes new folders for every week in your Drive (as drafts). The old folders stay where they are.
            </span>
          </div>
        )}
      </div>
    );
  }
  if (connection === undefined) {
    return <p className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">Checking your Google Drive…</p>;
  }
  if (!connection.connected) {
    return (
      <div className="mt-4 rounded-2xl bg-highlighter/45 p-4 sm:flex sm:items-center sm:gap-4">
        <div className="flex gap-3 sm:min-w-0 sm:flex-1">
          <DriveMark />
          <div className="min-w-0">
            <p className="font-medium">Connect Google Drive</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink/75">
              Your files stay in your own Drive. Kalami creates a folder for this course with one folder per week, and
              shares a week by link when you publish it. It can only see folders it created.
            </p>
            {connection.problem && !connection.problem.startsWith("Connect Google Drive") && (
              <p className="mt-1 text-sm text-red-pen">{connection.problem}</p>
            )}
          </div>
        </div>
        <Button onClick={onConnect} disabled={connecting} className="mt-4 w-full sm:mt-0 sm:w-auto">
          {connecting ? "Opening Google…" : "Connect Drive"}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm sm:flex sm:items-center sm:gap-3">
      <div className="flex items-center gap-3 sm:min-w-0 sm:flex-1">
        <DriveMark />
        <span className="min-w-0 text-graphite">
          Google Drive connected.{" "}
          {data.drive?.folderUrl
            ? "Upload files into each week's folder in Drive."
            : "Add a week and Kalami creates the course folder in your Drive."}
        </span>
      </div>
      {data.drive?.folderUrl && (
        <a
          href={data.drive.folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 pl-11 font-medium underline-offset-4 hover:underline sm:mt-0 sm:pl-0"
        >
          Course folder
          <ArrowUpRight className="size-4" />
        </a>
      )}
    </div>
  );
}

/** Drive's three-colour triangle, drawn simply. */
function DriveMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-8 shrink-0">
      <path d="M8.2 3h7.6l6 10.4h-7.6z" fill="#FBBC04" />
      <path d="M2.2 13.4 8.2 3l3.8 6.6-6 10.4z" fill="#34A853" />
      <path d="M6 20l3.8-6.6h12L18 20z" fill="#4285F4" />
    </svg>
  );
}

function WeekRow({
  week,
  canEdit,
  first,
  last,
  onEdit,
  run,
  actions,
}: {
  week: MaterialWeek;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  run: (action: () => Promise<void>) => Promise<void>;
  actions: MaterialsActions;
}) {
  const busy = week.syncing !== undefined && !week.stale;
  const status = weekStatus(week);
  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel">
          {week.source === "drive" ? <DriveMark /> : <Notebook className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{week.title}</span>
            <Pill tone={week.status === "published" ? "ok" : "panel"}>
              {week.status === "published" ? "Published" : "Draft"}
            </Pill>
          </span>
          <span className={`mt-0.5 block text-xs ${week.driveError ? "text-red-pen" : "text-graphite"}`}>{status}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {week.url && (
            <a
              href={week.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium hover:bg-panel"
            >
              {week.source === "drive" ? "Open folder" : "Open"}
              <ArrowUpRight className="size-4" />
            </a>
          )}
          {canEdit && (week.driveError || week.stale) && (
            <Button size="sm" variant="outline" onClick={() => run(() => actions.onRetry(week._id))}>
              Retry
            </Button>
          )}
          {canEdit && week.status === "draft" && (
            <Button
              size="sm"
              disabled={busy || (week.source === "drive" && week.url === undefined)}
              onClick={() => run(() => actions.onPublish(week._id))}
            >
              Publish
            </Button>
          )}
          {canEdit && week.status === "published" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => actions.onUnpublish(week._id))}>
              Unpublish
            </Button>
          )}
        </span>
      </div>
      {week.description && <p className="mt-2 pl-[3.25rem] text-sm text-ink/80">{week.description}</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1 pl-[3.25rem] text-xs">
          <button type="button" className="rounded-full px-2 py-1 text-graphite hover:bg-panel hover:text-ink" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            aria-label="Move up"
            disabled={first}
            className="rounded-full px-2 py-1 text-graphite hover:bg-panel hover:text-ink disabled:opacity-30"
            onClick={() => run(() => actions.onMove(week._id, "up"))}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={last}
            className="rounded-full px-2 py-1 text-graphite hover:bg-panel hover:text-ink disabled:opacity-30"
            onClick={() => run(() => actions.onMove(week._id, "down"))}
          >
            <ArrowDown className="size-3.5" />
          </button>
          {week.status === "draft" && !week.shared && !busy && (
            <RemoveButton
              source={week.source}
              onRemove={() => run(() => actions.onRemove(week._id))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RemoveButton({ source, onRemove }: { source: MaterialWeek["source"]; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="rounded-full px-2 py-1 text-graphite hover:bg-panel hover:text-ink" onClick={() => setConfirming(true)}>
        Remove…
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="px-1 text-graphite">
        {source === "drive" ? "Remove from Kalami? The folder stays in your Drive." : "Remove this link?"}
      </span>
      <button type="button" className="rounded-full bg-red-pen/10 px-2 py-1 font-medium text-red-pen" onClick={onRemove}>
        Remove
      </button>
      <button type="button" className="rounded-full px-2 py-1 text-graphite hover:bg-panel" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}

/** One line on where the week stands, for the lecturer. */
function weekStatus(week: MaterialWeek): string {
  if (week.driveError) return week.driveError;
  if (week.stale) return "Google Drive stopped answering. Retry.";
  if (week.syncing === "folder") return "Creating the folder in your Drive…";
  if (week.syncing === "share") return "Sharing the folder…";
  if (week.syncing === "unshare") return "Taking the sharing off…";
  if (week.source === "link") {
    const host = hostOf(week.url);
    return week.status === "published" ? `Students can open it · ${host}` : `Only you see it · ${host}`;
  }
  if (week.status === "published" && week.shared) return "Students can open the folder (anyone with the link can view)";
  return "Private folder. Upload files to it in Drive, then publish.";
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

function WeekForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: Editing;
  onSubmit: (values: { title: string; description: string; url: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const week = editing.mode === "edit" ? editing.week : undefined;
  const isLink = editing.mode === "link" || week?.source === "link";
  const [title, setTitle] = useState(week?.title ?? "");
  const [description, setDescription] = useState(week?.description ?? "");
  const [url, setUrl] = useState(week?.source === "link" ? (week.url ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title, description, url });
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const heading = week ? "Edit week" : isLink ? "Add a link" : "New week";
  const blurb = week
    ? undefined
    : isLink
      ? "A link to materials hosted anywhere: OneDrive, Dropbox, a website. You manage who can open it."
      : "Kalami creates a private folder for it in your Google Drive. Upload files there, then publish the week.";

  return (
    <form onSubmit={submit} className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">{heading}</h2>
      {blurb && <p className="mt-2 text-[15px] text-graphite">{blurb}</p>}
      <div className="mt-6 space-y-5">
        <Field label="Title" htmlFor="week-title">
          <TextInput
            id="week-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Week 1 · Introduction"
            maxLength={120}
            autoFocus
            required
          />
        </Field>
        {isLink && (
          <Field label="Link" htmlFor="week-url">
            <TextInput
              id="week-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              maxLength={2000}
              required
            />
          </Field>
        )}
        <Field label="Note for students" htmlFor="week-description" optional>
          <TextArea
            id="week-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Read chapter 2 before Thursday."
          />
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || title.trim() === "" || (isLink && url.trim() === "")}>
          {week ? "Save" : isLink ? "Add link" : "Create folder"}
        </Button>
      </div>
    </form>
  );
}
