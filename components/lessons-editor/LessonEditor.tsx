"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { Block } from "@/components/lessons/LessonBlocks";
import { LessonSlides } from "@/components/lessons/LessonSlides";
import type { LessonBlock, LessonBlockType } from "@/components/lessons/types";
import type { LessonBlockInput, LessonDetail } from "@/components/studio/types";
import { Button, buttonClass } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { FormError, Segmented } from "@/components/ui/form";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Duplicate, Pen, Plus, Robot, Trash } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { BlockForm, BlockIcon, SmallIcon } from "./BlockForms";
import {
  adopt,
  BLOCK_LABEL,
  BLOCK_TYPES,
  blankBlock,
  blockProblems,
  contentKey,
  duplicateItem,
  fromServer,
  newKey,
  previewGap,
  toInput,
  type DraftItem,
} from "./draft";

type Mode = "edit" | "preview";

/**
 * The lesson editor: a lesson is a list of blocks, edited here as a draft and
 * saved whole (Save, or Ctrl/Cmd+S). Students read a lesson as slides, one
 * block per slide; wide screens show that slide beside the blocks, following
 * the block being edited, with the same player students use. Phones switch
 * between Edit and Preview.
 */
export function LessonEditor({
  lesson,
  onRename,
  onSaveBlocks,
  onSetStatus,
  onDelete,
  initialMode = "edit",
}: {
  lesson: LessonDetail;
  onRename: (title: string) => Promise<void>;
  /** Saves every block; returns the ids they ended up with, in order. */
  onSaveBlocks: (blocks: LessonBlockInput[]) => Promise<string[]>;
  onSetStatus: (status: "draft" | "published") => Promise<void>;
  onDelete: () => Promise<void>;
  initialMode?: Mode;
}) {
  const canEdit = lesson.canEdit;
  const [mode, setMode] = useState<Mode>(canEdit ? initialMode : "preview");
  const [items, setItems] = useState<DraftItem[]>(() => fromServer(lesson.blocks));
  const [saved, setSaved] = useState(() => contentKey(fromServer(lesson.blocks)));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<{ message: string; key?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The block being edited, by its draft key; the preview shows its slide.
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const dirty = contentKey(items) !== saved;

  // Changes that didn't come from this editor (an agent, another tab): take them
  // in when there's nothing unsaved here, otherwise say so. Our own saves and
  // status changes also move updatedAt; `ownPending` counts those so they aren't
  // mistaken for someone else's.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(lesson.updatedAt);
  const [ownPending, setOwnPending] = useState(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  if (lesson.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(lesson.updatedAt);
    if (ownPending > 0) {
      setOwnPending(ownPending - 1);
    } else if (!dirty) {
      const next = adopt(lesson.blocks, items);
      setItems(next);
      setSaved(contentKey(next));
      setRemoteChanged(false);
    } else {
      setRemoteChanged(true);
    }
  }

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  async function save(): Promise<boolean> {
    if (!canEdit || saveState === "saving") return false;
    const sent = items;
    const sentKey = contentKey(sent);
    setSaveState("saving");
    setSaveError(null);
    setOwnPending((n) => n + 1);
    try {
      const ids = await onSaveBlocks(sent.map((item) => toInput(item.block)));
      const idByKey = new Map(sent.map((item, i) => [item.key, ids[i]]));
      setItems((current) =>
        current.map((item) => {
          const id = idByKey.get(item.key);
          return id === undefined ? item : { ...item, block: { ...item.block, id } };
        }),
      );
      setSaved(sentKey);
      setSaveState("saved");
      return true;
    } catch (caught) {
      setOwnPending((n) => Math.max(0, n - 1));
      const message = errorMessage(caught);
      // "Block 3: text can't be empty." points at a block: mark it and bring it into view.
      const match = /^Block (\d+):/.exec(message);
      const key = match ? sent[Number(match[1]) - 1]?.key : undefined;
      setSaveError({ message, key });
      setSaveState("idle");
      document.getElementById(key ? `block-${key}` : "lesson-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
  }

  /** A change made here that moves updatedAt (rename, publish). */
  async function own(action: () => Promise<void>): Promise<boolean> {
    setActionError(null);
    setOwnPending((n) => n + 1);
    try {
      await action();
      return true;
    } catch (caught) {
      setOwnPending((n) => Math.max(0, n - 1));
      setActionError(errorMessage(caught));
      return false;
    }
  }

  async function setStatus(status: "draft" | "published") {
    setStatusBusy(true);
    if (status === "published" && dirty && !(await save())) {
      setStatusBusy(false);
      return;
    }
    await own(() => onSetStatus(status));
    setStatusBusy(false);
  }

  // Ctrl/Cmd+S saves.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty) void save();
    }
  });
  useEffect(() => {
    if (!canEdit) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [canEdit]);

  // Unsaved changes: warn before the tab closes or reloads, and before an in-app link leaves the page.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a return value to show the prompt.
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("This lesson has unsaved changes. Leave without saving them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // --- Editing the list ---

  function update(key: string, block: LessonBlock) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, block } : item)));
    if (saveError?.key === key) setSaveError(null);
  }

  function insert(index: number, type: LessonBlockType) {
    const item = { key: newKey(), block: blankBlock(type) };
    setItems((current) => [...current.slice(0, index), item, ...current.slice(index)]);
    setSelected(item.key);
    setFresh(item.key);
  }

  function move(index: number, direction: -1 | 1) {
    setItems((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function duplicate(index: number) {
    const copy = duplicateItem(items[index]);
    setItems((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
    setSelected(copy.key);
    setFresh(copy.key);
  }

  function remove(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
    if (selected === key) setSelected(null);
    if (saveError?.key === key) setSaveError(null);
  }

  // Blocks keyed by the editor's keys, so previews keep their state while ids change on save.
  const previewItems = items.map((item) => ({ ...item.block, id: item.key }));
  const readyBlocks = previewItems.filter((block) => previewGap(block) === null);
  const unfinished = previewItems.length - readyBlocks.length;

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
        <Link href={`/courses/${lesson.courseId}`} className="inline-flex items-center gap-2 rounded-full hover:text-ink">
          <ArrowLeft className="size-4" />
          {lesson.courseTitle}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/courses/${lesson.courseId}#week-${lesson.weekId}`} className="rounded-full hover:text-ink">
          {lesson.weekTitle}
        </Link>
      </nav>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="ink">Lesson</Pill>
            <Pill tone={statusTone(lesson.status)}>{statusLabel(lesson.status)}</Pill>
            {lesson.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Drafted by an agent
              </Pill>
            )}
            {!canEdit && <Pill>View only</Pill>}
          </div>
          <TitleEditor title={lesson.title} canEdit={canEdit} onRename={(title) => own(() => onRename(title))} />
          <p className="mt-3 text-[15px] text-graphite">
            {items.length} block{items.length === 1 ? "" : "s"}
            {dirty && " · unsaved changes"}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              label="Editor view"
              value={mode}
              options={[
                { value: "edit", label: "Edit" },
                { value: "preview", label: "Preview" },
              ]}
              onChange={setMode}
            />
            {lesson.status === "draft" ? (
              <Button variant="lime" disabled={statusBusy || items.length === 0} onClick={() => setStatus("published")}>
                <Check className="size-4" />
                {dirty ? "Save and publish" : "Publish"}
              </Button>
            ) : (
              <Button variant="outline" disabled={statusBusy} onClick={() => setStatus("draft")}>
                Move back to draft
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          </div>
        )}
      </div>

      <VisibilityBanner lesson={lesson} />

      <div id="lesson-errors" className="scroll-mt-28">
        {actionError && (
          <div className="mt-4">
            <FormError>{actionError}</FormError>
          </div>
        )}
        {saveError && (
          <div className="mt-4">
            <FormError>
              Not saved. {saveError.message}
              {saveError.key && " The block is marked below."}
            </FormError>
          </div>
        )}
        {remoteChanged && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-64">
              This lesson was changed somewhere else (your agent, or another tab) while you were editing. Saving keeps
              your version.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = adopt(lesson.blocks, items);
                setItems(next);
                setSaved(contentKey(next));
                setRemoteChanged(false);
              }}
            >
              Load theirs instead
            </Button>
          </div>
        )}
      </div>

      {mode === "preview" ? (
        <article className="mx-auto mt-8 max-w-[52rem] rounded-[2rem] bg-paper px-3 py-6 ring-1 ring-line sm:px-8 sm:py-10">
          <div className="px-2 sm:px-0">
            {dirty && <p className="mb-3 font-hand text-xl leading-none text-graphite">Previewing your unsaved changes</p>}
            <p className="text-sm text-graphite">
              {lesson.courseTitle} · {lesson.weekTitle}
            </p>
            <h2 className="mt-1.5 text-2xl font-medium leading-tight tracking-[-0.03em] sm:text-3xl">{lesson.title}</h2>
            {unfinished > 0 && (
              <p className="mt-2 text-sm text-graphite">
                {unfinished} unfinished block{unfinished === 1 ? " isn't" : "s aren't"} shown: {readyBlocks.length} slide
                {readyBlocks.length === 1 ? "" : "s"} of {previewItems.length} blocks.
              </p>
            )}
          </div>
          <LessonSlides
            blocks={readyBlocks}
            followId={selected}
            onNavigate={setSelected}
            label={`${lesson.title}, preview`}
            className="mt-6"
            empty={
              <p className="mt-6 rounded-3xl border-2 border-dashed border-line px-5 py-8 text-center text-graphite">
                Nothing to read yet.
              </p>
            }
          />
        </article>
      ) : (
        <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {items.length === 0 ? (
              <EmptyLesson onAdd={(type) => insert(0, type)} />
            ) : (
              <ol aria-label="Lesson blocks">
                <li>
                  <InsertPoint label="Add a block at the start" onAdd={(type) => insert(0, type)} />
                </li>
                {items.map((item, index) => (
                  <li key={item.key}>
                    <BlockCard
                      item={item}
                      index={index}
                      total={items.length}
                      selected={selected === item.key}
                      autoFocus={fresh === item.key}
                      error={saveError?.key === item.key ? saveError.message : undefined}
                      onSelect={() => setSelected(item.key)}
                      onChange={(block) => update(item.key, block)}
                      onMove={(direction) => move(index, direction)}
                      onDuplicate={() => duplicate(index)}
                      onRemove={() => remove(item.key)}
                    />
                    {index < items.length - 1 ? (
                      <InsertPoint label={`Add a block after block ${index + 1}`} onAdd={(type) => insert(index + 1, type)} />
                    ) : (
                      <div className="mt-4">
                        <AddBlockMenu label="Add a block at the end" onAdd={(type) => insert(items.length, type)} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {/* In the blocks' column, so it floats over the forms and never over the preview. */}
            {canEdit && (
              <SaveBar dirty={dirty} state={saveState} failed={saveError !== null} floating onSave={() => void save()} />
            )}
          </div>

          <aside aria-label="Live preview" className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-24 flex max-h-[calc(100dvh-8rem)] flex-col rounded-[2rem] bg-paper p-5 ring-1 ring-line">
              <p className="font-hand text-[1.35rem] leading-none text-graphite">As students see it</p>
              <p className="mt-1 text-xs text-graphite">One slide per block. Click into a block to see its slide.</p>
              {/* Unfinished blocks stay in as notes, so the slides line up with the blocks. */}
              <LessonSlides
                blocks={previewItems}
                followId={selected}
                onNavigate={setSelected}
                renderBlock={(block) => <PreviewBlock block={block} />}
                compact
                label="Live preview"
                className="mt-4 flex-1"
                empty={
                  <p className="mt-4 rounded-3xl border-2 border-dashed border-line px-5 py-8 text-center text-sm text-graphite">
                    Nothing to read yet.
                  </p>
                }
              />
            </div>
          </aside>
        </div>
      )}

      {canEdit && mode === "preview" && (
        <SaveBar dirty={dirty} state={saveState} failed={saveError !== null} floating={false} onSave={() => void save()} />
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete lesson">
        {confirmDelete && (
          <DeleteLesson
            title={lesson.title}
            blockCount={lesson.blocks.length}
            published={lesson.status === "published" && lesson.weekStatus === "published"}
            onDelete={onDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

// --- Header pieces ----------------------------------------------------------------------

function TitleEditor({
  title,
  canEdit,
  onRename,
}: {
  title: string;
  canEdit: boolean;
  onRename: (title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const heading = "mt-3 text-4xl font-medium leading-[1.02] tracking-[-0.04em] sm:text-5xl";

  if (!canEdit) {
    return <h1 className={heading}>{title}</h1>;
  }
  if (!editing) {
    return (
      <h1 className={heading}>
        <button
          type="button"
          onClick={() => {
            setValue(title);
            setEditing(true);
          }}
          className="group -mx-2 inline rounded-2xl px-2 text-left transition hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {title}
          <span className="sr-only"> (rename)</span>
          <Pen className="ml-2 inline size-6 align-baseline text-graphite opacity-40 transition group-hover:opacity-100" />
        </button>
      </h1>
    );
  }

  async function commit() {
    const next = value.trim();
    if (next === "" || next === title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const ok = await onRename(next);
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void commit();
      }}
    >
      <label htmlFor="lesson-title" className="sr-only">
        Lesson title
      </label>
      <input
        id="lesson-title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        maxLength={160}
        autoFocus
        disabled={busy}
        className="min-w-0 flex-1 basis-64 rounded-2xl border border-ink bg-card px-3 py-1 text-3xl font-medium tracking-[-0.03em] outline-none focus:ring-4 focus:ring-highlighter/60 sm:text-4xl"
      />
      <Button type="submit" size="sm" disabled={busy || value.trim() === ""}>
        Save
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

function VisibilityBanner({ lesson }: { lesson: LessonDetail }) {
  let title: string;
  let body: string;
  let tone: string;
  if (lesson.weekStatus === "draft") {
    title = "This week isn’t published yet";
    body =
      lesson.status === "published"
        ? `Students see this lesson as soon as you publish “${lesson.weekTitle}”.`
        : `Students see nothing in “${lesson.weekTitle}” until you publish the week, which publishes this lesson too.`;
    tone = "bg-card ring-1 ring-line";
  } else if (lesson.status === "published") {
    title = "Published: students see changes as soon as you save";
    body = "Fixing a typo is fine. For big rewrites, move it back to draft first.";
    tone = "bg-highlighter/45";
  } else {
    title = "Draft: students don’t see it yet";
    body = `The rest of “${lesson.weekTitle}” is visible. Publish this lesson when it’s ready.`;
    tone = "bg-card ring-1 ring-line";
  }
  return (
    <div className={`mt-5 max-w-3xl rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-graphite">{body}</p>
    </div>
  );
}

// --- Blocks -----------------------------------------------------------------------------

function BlockCard({
  item,
  index,
  total,
  selected,
  autoFocus,
  error,
  onSelect,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  total: number;
  selected: boolean;
  autoFocus: boolean;
  error?: string;
  onSelect: () => void;
  onChange: (block: LessonBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { block, key } = item;
  const ref = useRef<HTMLElement>(null);
  const [confirming, setConfirming] = useState(false);
  const problems = blockProblems(block);
  const untouched = contentKey([{ key, block }]) === contentKey([{ key, block: blankBlock(block.type) }]);
  const label = BLOCK_LABEL[block.type];

  useEffect(() => {
    if (autoFocus) {
      ref.current?.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]), textarea, select")?.focus();
    }
  }, [autoFocus]);

  return (
    <article
      ref={ref}
      id={`block-${key}`}
      aria-label={`Block ${index + 1}: ${label}`}
      onFocus={onSelect}
      onPointerDown={onSelect}
      className={`scroll-mt-28 rounded-[1.75rem] bg-card p-4 ring-2 transition sm:p-5 ${
        error ? "ring-red-pen/70" : selected ? "ring-ink/15" : "ring-transparent"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel text-xs font-semibold tabular-nums">
          {index + 1}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <BlockIcon type={block.type} />
          {label}
          {block.type === "callout" && <span className="font-normal text-graphite">· {calloutLabel(block.tone)}</span>}
          {block.type === "code" && <span className="font-mono text-xs font-normal uppercase text-graphite">· {block.language}</span>}
        </span>
        <span className="ml-auto flex items-center">
          <SmallIcon label={`Move block ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </SmallIcon>
          <SmallIcon label={`Move block ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </SmallIcon>
          <SmallIcon label={`Duplicate block ${index + 1}`} onClick={onDuplicate}>
            <Duplicate className="size-4" />
          </SmallIcon>
          <SmallIcon label={`Delete block ${index + 1}`} onClick={() => (untouched ? onRemove() : setConfirming(true))}>
            <Trash className="size-4" />
          </SmallIcon>
        </span>
      </header>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-2xl bg-red-pen/10 px-4 py-2 text-sm">
          <span className="mr-auto text-red-pen">Delete this {label.toLowerCase()} block?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            Delete
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-red-pen/10 px-4 py-2 text-sm text-red-pen">
          {error}
        </p>
      )}
      <div className="mt-4">
        <BlockForm block={block} uid={`b-${key}`} onChange={onChange} />
      </div>
      {problems.length > 0 && !untouched && (
        <ul className="mt-4 space-y-1 text-xs text-graphite">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function calloutLabel(tone: string): string {
  return tone === "warning" ? "Watch out" : tone.charAt(0).toUpperCase() + tone.slice(1);
}

function PreviewBlock({ block }: { block: LessonBlock }) {
  const gap = previewGap(block);
  if (gap) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-line px-5 py-6 text-center text-sm text-graphite">{gap}</div>
    );
  }
  return <Block block={block} />;
}

function blockMenuItems(onAdd: (type: LessonBlockType) => void) {
  return BLOCK_TYPES.map((t) => ({
    label: t.label,
    description: t.description,
    icon: <BlockIcon type={t.type} />,
    onSelect: () => onAdd(t.type),
  }));
}

function AddBlockMenu({ label, onAdd }: { label: string; onAdd: (type: LessonBlockType) => void }) {
  return (
    <Menu label={label} align="start" items={blockMenuItems(onAdd)} buttonClassName={buttonClass("outline", "md")}>
      <Plus className="size-4" />
      Add block
    </Menu>
  );
}

/** The small "+" between two blocks. */
function InsertPoint({ label, onAdd }: { label: string; onAdd: (type: LessonBlockType) => void }) {
  return (
    <div className="group flex items-center gap-2 py-1.5 pl-3">
      <Menu
        label={label}
        align="start"
        items={blockMenuItems(onAdd)}
        buttonClassName="grid size-7 place-items-center rounded-full border border-line bg-card text-graphite opacity-70 transition hover:border-ink hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Plus className="size-3.5" />
      </Menu>
      <span aria-hidden className="h-px flex-1 bg-line opacity-0 transition group-hover:opacity-100" />
    </div>
  );
}

function EmptyLesson({ onAdd }: { onAdd: (type: LessonBlockType) => void }) {
  return (
    <section className="rounded-[2rem] border-2 border-dashed border-ink/15 p-5 sm:p-8">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A blank page</p>
      <h2 className="mt-3 text-2xl font-medium tracking-tight">Start with a block</h2>
      <p className="mt-1 max-w-lg text-[15px] text-graphite">
        A lesson is a list of blocks. Keep it to one topic, roughly 5 to 25 blocks: something a student finishes in 10 to
        20 minutes.
      </p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {BLOCK_TYPES.map((t) => (
          <li key={t.type}>
            <button
              type="button"
              onClick={() => onAdd(t.type)}
              className="flex w-full items-start gap-3 rounded-2xl bg-card p-3.5 text-left transition hover:ring-2 hover:ring-ink/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-highlighter/60">
                <BlockIcon type={t.type} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-graphite">{t.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-graphite">
        Or ask your agent:{" "}
        <span className="font-hand text-lg text-ink">“Write this lesson, with examples and a quick check.”</span>
      </p>
    </section>
  );
}

// --- Saving and deleting ----------------------------------------------------------------

function SaveBar({
  dirty,
  state,
  failed,
  floating,
  onSave,
}: {
  dirty: boolean;
  state: "idle" | "saving" | "saved";
  failed: boolean;
  /** Stays in view while scrolling; off in Preview, where the slide controls float instead. */
  floating: boolean;
  onSave: () => void;
}) {
  const text =
    state === "saving" ? "Saving…" : failed ? "Not saved: see the message above" : dirty ? "Unsaved changes" : "Saved";
  return (
    <div className={`pointer-events-none z-20 mt-6 flex justify-center ${floating ? "sticky bottom-3 sm:bottom-5" : ""}`}>
      <div
        className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full py-2 pl-5 pr-2 shadow-xl shadow-ink/15 ring-1 transition ${
          dirty ? "bg-ink text-paper ring-ink" : "bg-card text-ink ring-line"
        }`}
      >
        <span role="status" className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {dirty ? (
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${failed ? "bg-red-pen" : "bg-highlighter"}`} />
          ) : (
            <Check className="size-4 shrink-0 text-ok" />
          )}
          <span className="truncate">{text}</span>
        </span>
        <kbd className={`hidden font-sans text-xs sm:inline ${dirty ? "text-paper/55" : "text-graphite"}`}>Ctrl/⌘ S</kbd>
        <Button size="sm" variant={dirty ? "lime" : "outline"} disabled={!dirty || state === "saving"} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

function DeleteLesson({
  title,
  blockCount,
  published,
  onDelete,
  onCancel,
}: {
  title: string;
  blockCount: number;
  published: boolean;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Delete this lesson?</h2>
      <p className="mt-3 text-[15px] text-graphite">
        “{title}” and its {blockCount} block{blockCount === 1 ? "" : "s"} will be gone
        {published ? ", and students stop seeing it" : ""}. This can’t be undone.
      </p>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete lesson"}
        </Button>
      </div>
    </div>
  );
}
