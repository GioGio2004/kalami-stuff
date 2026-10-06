"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { SmallIcon } from "@/components/lessons-editor/BlockForms";
import { KalamiFileIcon } from "@/components/kalami/KalamiFile";
import { SaveBar, TitleEditor } from "@/components/lessons-editor/LessonEditor";
import { DeckPlayer, SlideThumb, type DeckPlayerHandle } from "@/components/presentations/DeckPlayer";
import type { PresentationDetail } from "@/components/studio/types";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { FormError, Segmented, TextArea } from "@/components/ui/form";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Duplicate, LinkChain, Play, Plus, Robot, Trash } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import {
  DECK_THEMES,
  sectionNumbers,
  SLIDE_TYPE_INFO,
  SLIDE_TYPES,
  slideLabel,
  slideTone,
  THEME_INFO,
  type DeckTheme,
  type Slide,
  type SlideType,
} from "@/lib/presentation";
import {
  adopt,
  blankSlide,
  contentKey,
  duplicate as duplicateSlide,
  fromServer,
  newKey,
  problemsBySlide,
  toInputs,
  type DraftSlide,
} from "./draft";
import { SharePresentation } from "./SharePresentation";
import { SlideForm } from "./SlideForms";

type Mode = "edit" | "preview";

/**
 * The presentation editor. A deck is a theme and a list of slides; each slide
 * is a type and its words, edited in a plain form (nothing about position or
 * colour: the type lays it out, the theme colours it). The whole deck is
 * saved at once (Save, or Ctrl/Cmd+S). Wide screens play the selected slide
 * beside the forms, with the player students use; Present plays the unsaved
 * draft full screen. Phones switch between Edit and Preview.
 */
export function PresentationEditor({
  deck,
  onRename,
  onSave,
  onSetStatus,
  onDelete,
  onExport,
  onShare,
  onStopSharing,
  initialMode = "edit",
  initialSharing = false,
}: {
  deck: PresentationDetail;
  onRename: (title: string) => Promise<void>;
  /** Saves the theme and every slide; returns the ids the slides ended up with, in order. */
  onSave: (draft: { theme: DeckTheme; slides: ReturnType<typeof toInputs> }) => Promise<string[]>;
  onSetStatus: (status: "draft" | "published") => Promise<void>;
  onDelete: () => Promise<void>;
  /** Downloads the presentation as a .kalami file (saved changes only). */
  onExport?: () => Promise<void>;
  /** Turns its public link on (or changes it); `newLink` replaces the link. */
  onShare?: (options: { notes: boolean; newLink?: boolean }) => Promise<void>;
  /** Turns its public link off. */
  onStopSharing?: () => Promise<void>;
  initialMode?: Mode;
  /** Opens with the Share dialog showing (the dev gallery). */
  initialSharing?: boolean;
}) {
  const canEdit = deck.canEdit;
  const [mode, setMode] = useState<Mode>(canEdit ? initialMode : "preview");
  const [theme, setTheme] = useState<DeckTheme>(deck.theme);
  const [items, setItems] = useState<DraftSlide[]>(() => fromServer(deck.slides));
  const [saved, setSaved] = useState(() => contentKey(deck.theme, fromServer(deck.slides)));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => deck.slides[0]?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(initialSharing);
  const shareable = onShare !== undefined && onStopSharing !== undefined && (deck.canShare || deck.share !== null);

  const dirty = contentKey(theme, items) !== saved;
  const problems = problemsBySlide(theme, items);
  const problemCount = [...problems.slides.values()].reduce((sum, list) => sum + list.length, 0) + problems.deck.length;

  // Changes from somewhere else (an agent, another tab): taken in when nothing here is unsaved.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(deck.updatedAt);
  const [ownPending, setOwnPending] = useState(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  if (deck.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(deck.updatedAt);
    if (ownPending > 0) {
      setOwnPending(ownPending - 1);
    } else if (!dirty) {
      const next = adopt(deck.slides, items);
      setItems(next);
      setTheme(deck.theme);
      setSaved(contentKey(deck.theme, next));
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
    if (problemCount > 0) {
      setSaveError(`Fix the ${problemCount === 1 ? "problem" : `${problemCount} problems`} marked below first.`);
      const first = items[[...problems.slides.keys()].sort((a, b) => a - b)[0] ?? -1];
      if (first) document.getElementById(`slide-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    const sent = items;
    const sentTheme = theme;
    setSaveState("saving");
    setSaveError(null);
    setOwnPending((n) => n + 1);
    try {
      const ids = await onSave({ theme: sentTheme, slides: toInputs(sent) });
      const idByKey = new Map(sent.map((item, i) => [item.key, ids[i]]));
      setItems((current) =>
        current.map((item) => {
          const id = idByKey.get(item.key);
          return id === undefined ? item : { ...item, slide: { ...item.slide, id } };
        }),
      );
      setSaved(contentKey(sentTheme, sent));
      setSaveState("saved");
      return true;
    } catch (caught) {
      setOwnPending((n) => Math.max(0, n - 1));
      setSaveError(errorMessage(caught));
      setSaveState("idle");
      document.getElementById("deck-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
  }

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

  // Unsaved changes: warn before the tab closes, and before an in-app link leaves the page.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("This presentation has unsaved changes. Leave without saving them?")) {
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

  function update(key: string, slide: Slide) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, slide } : item)));
    if (saveError) setSaveError(null);
  }

  function insert(index: number, type: SlideType) {
    const item = { key: newKey(), slide: blankSlide(type) };
    setItems((current) => [...current.slice(0, index), item, ...current.slice(index)]);
    setSelected(item.key);
    requestAnimationFrame(() => document.getElementById(`slide-${item.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function move(index: number, by: -1 | 1) {
    setItems((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function copy(index: number) {
    const item = duplicateSlide(items[index]);
    setItems((current) => [...current.slice(0, index + 1), item, ...current.slice(index + 1)]);
    setSelected(item.key);
  }

  function remove(key: string) {
    if (items.length <= 1) return;
    setItems((current) => current.filter((item) => item.key !== key));
    if (selected === key) setSelected(null);
  }

  // The deck as the player sees it: the draft, keyed by the editor's keys so the preview keeps its place.
  const previewDeck = { theme, slides: items.map((item) => ({ ...item.slide, id: item.key })) };
  const selectedIndex = Math.max(0, items.findIndex((item) => item.key === selected));
  const sections = sectionNumbers(previewDeck.slides);

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
        <Link href={`/courses/${deck.courseId}`} className="inline-flex items-center gap-2 rounded-full hover:text-ink">
          <ArrowLeft className="size-4" />
          {deck.courseTitle}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/courses/${deck.courseId}#week-${deck.weekId}`} className="rounded-full hover:text-ink">
          {deck.weekTitle}
        </Link>
      </nav>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="ink">Presentation</Pill>
            <Pill tone={statusTone(deck.status)}>{statusLabel(deck.status)}</Pill>
            {deck.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Drafted by an agent
              </Pill>
            )}
            {deck.share && (
              <Pill tone="ok">
                <LinkChain className="size-3.5" />
                Shared by link
              </Pill>
            )}
            {!canEdit && <Pill>View only</Pill>}
          </div>
          <TitleEditor title={deck.title} canEdit={canEdit} label="Presentation title" onRename={(title) => own(() => onRename(title))} />
          <p className="mt-3 text-[15px] text-graphite">
            {items.length} slide{items.length === 1 ? "" : "s"} · {THEME_INFO[theme].label}
            {dirty && " · unsaved changes"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {canEdit && (
            <Segmented
              label="Editor view"
              value={mode}
              options={[
                { value: "edit", label: "Edit" },
                { value: "preview", label: "Preview" },
              ]}
              onChange={setMode}
            />
          )}
          <Button variant="outline" onClick={() => setPresenting(true)}>
            <Play className="size-4" />
            Present
          </Button>
          {shareable && (
            <Button variant="outline" onClick={() => setSharing(true)}>
              <LinkChain className="size-4" />
              Share
            </Button>
          )}
          {onExport && (
            <Button
              variant="outline"
              disabled={exporting}
              title={dirty ? "Exports the saved version: save first to include your changes" : "Download it as a .kalami file, to import into another course or another Kalami"}
              onClick={async () => {
                setExporting(true);
                setActionError(null);
                try {
                  await onExport();
                } catch (caught) {
                  setActionError(errorMessage(caught));
                } finally {
                  setExporting(false);
                }
              }}
            >
              <KalamiFileIcon className="h-4 w-auto" decorative />
              {exporting ? "Exporting…" : "Export .kalami"}
            </Button>
          )}
          {canEdit &&
            (deck.status === "draft" ? (
              <Button variant="lime" disabled={statusBusy} onClick={() => setStatus("published")}>
                <Check className="size-4" />
                {dirty ? "Save and publish" : "Publish"}
              </Button>
            ) : (
              <Button variant="outline" disabled={statusBusy} onClick={() => setStatus("draft")}>
                Move back to draft
              </Button>
            ))}
          {canEdit && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          )}
        </div>
      </div>

      <VisibilityBanner deck={deck} />

      <div id="deck-errors" className="scroll-mt-28">
        {actionError && (
          <div className="mt-4">
            <FormError>{actionError}</FormError>
          </div>
        )}
        {saveError && (
          <div className="mt-4">
            <FormError>Not saved. {saveError}</FormError>
          </div>
        )}
        {problems.deck.length > 0 && (
          <div className="mt-4">
            <FormError>{problems.deck.join(" ")}</FormError>
          </div>
        )}
        {remoteChanged && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-64">
              This presentation was changed somewhere else (your agent, or another tab) while you were editing. Saving
              keeps your version.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = adopt(deck.slides, items);
                setItems(next);
                setTheme(deck.theme);
                setSaved(contentKey(deck.theme, next));
                setRemoteChanged(false);
              }}
            >
              Load theirs instead
            </Button>
          </div>
        )}
      </div>

      {canEdit && <ThemePicker theme={theme} slide={previewDeck.slides[0]} onChange={setTheme} />}

      {mode === "preview" ? (
        <div className="mx-auto mt-8 max-w-[72rem]">
          {dirty && <p className="mb-3 font-hand text-xl leading-none text-graphite">Previewing your unsaved changes</p>}
          <DeckPlayer deck={previewDeck} title={deck.title} followIndex={selectedIndex} onIndexChange={(i) => setSelected(items[i]?.key ?? null)} />
        </div>
      ) : (
        <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <ol aria-label="Slides" className="space-y-0">
              <li>
                <InsertPoint label="Add a slide at the start" onAdd={(type) => insert(0, type)} />
              </li>
              {items.map((item, index) => (
                <li key={item.key}>
                  <SlideCard
                    item={item}
                    index={index}
                    total={items.length}
                    theme={theme}
                    sectionNumber={sections.get(index)}
                    selected={selected === item.key}
                    problems={problems.slides.get(index) ?? []}
                    canEdit={canEdit}
                    onSelect={() => setSelected(item.key)}
                    onChange={(slide) => update(item.key, slide)}
                    onMove={(by) => move(index, by)}
                    onDuplicate={() => copy(index)}
                    onRemove={() => remove(item.key)}
                  />
                  <InsertPoint
                    label={index < items.length - 1 ? `Add a slide after slide ${index + 1}` : "Add a slide at the end"}
                    onAdd={(type) => insert(index + 1, type)}
                    prominent={index === items.length - 1}
                  />
                </li>
              ))}
            </ol>
            {canEdit && <SaveBar dirty={dirty} state={saveState} failed={saveError !== null} floating onSave={() => void save()} />}
          </div>

          <aside aria-label="Live preview" className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-24 rounded-[2rem] bg-paper p-5 ring-1 ring-line">
              <p className="font-hand text-[1.35rem] leading-none text-graphite">As students see it</p>
              <p className="mt-1 text-xs text-graphite">Click a slide&apos;s card to play it here. Present plays the whole deck full screen.</p>
              <DeckPlayer
                deck={previewDeck}
                title={deck.title}
                mode="compact"
                followIndex={selectedIndex}
                onIndexChange={(i) => setSelected(items[i]?.key ?? null)}
                className="mt-4"
              />
            </div>
          </aside>
        </div>
      )}

      {canEdit && mode === "preview" && (
        <SaveBar dirty={dirty} state={saveState} failed={saveError !== null} floating={false} onSave={() => void save()} />
      )}

      {presenting && <Presenter deck={previewDeck} title={deck.title} start={selectedIndex} onDone={() => setPresenting(false)} />}

      <Dialog open={sharing} onClose={() => setSharing(false)} label="Share presentation">
        {sharing && shareable && (
          <SharePresentation deck={deck} dirty={dirty} onShare={onShare} onStop={onStopSharing} onClose={() => setSharing(false)} />
        )}
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete presentation">
        {confirmDelete && (
          <DeletePresentation
            title={deck.title}
            slideCount={deck.slides.length}
            published={deck.status === "published" && deck.weekStatus === "published"}
            onDelete={onDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

// --- Pieces -------------------------------------------------------------------------------

/** The draft, full screen: a page-mode player that starts presenting as soon as it's on the page. */
function Presenter({
  deck,
  title,
  start,
  onDone,
}: {
  deck: { theme: DeckTheme; slides: Slide[] };
  title: string;
  start: number;
  onDone: () => void;
}) {
  const player = useRef<DeckPlayerHandle>(null);
  const [startAt] = useState(start);
  useLayoutEffect(() => {
    player.current?.present();
  }, []);
  return (
    <DeckPlayer
      ref={player}
      deck={deck}
      title={title}
      followIndex={startAt}
      onPresentingChange={(on) => {
        if (!on) onDone();
      }}
    />
  );
}

function ThemePicker({ theme, slide, onChange }: { theme: DeckTheme; slide?: Slide; onChange: (theme: DeckTheme) => void }) {
  return (
    <section aria-label="Theme" className="mt-6">
      <p className="px-1 text-sm font-medium">Theme</p>
      <p className="mt-0.5 px-1 text-xs text-graphite">Colours, type and motion for every slide. Change it any time.</p>
      <div role="radiogroup" aria-label="Theme" className="mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {DECK_THEMES.map((name) => {
          const active = name === theme;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(name)}
              title={THEME_INFO[name].mood}
              className={`w-44 shrink-0 snap-start rounded-2xl p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                active ? "bg-ink text-paper" : "bg-card ring-1 ring-line hover:ring-ink/30"
              }`}
            >
              {slide ? (
                <SlideThumb slide={slide} theme={name} className="aspect-video w-full overflow-hidden rounded-xl" />
              ) : (
                <span className="block aspect-video w-full rounded-xl" />
              )}
              <span className="mt-1.5 flex items-center justify-between gap-2 px-1.5 pb-0.5 text-sm font-medium">
                {THEME_INFO[name].label}
                {active && <Check className="size-4 text-highlighter" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SlideCard({
  item,
  index,
  total,
  theme,
  sectionNumber,
  selected,
  problems,
  canEdit,
  onSelect,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  item: DraftSlide;
  index: number;
  total: number;
  theme: DeckTheme;
  sectionNumber?: number;
  selected: boolean;
  problems: string[];
  canEdit: boolean;
  onSelect: () => void;
  onChange: (slide: Slide) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { slide, key } = item;
  const [notesOpen, setNotesOpen] = useState(Boolean(slide.notes));
  const info = SLIDE_TYPE_INFO[slide.type];
  return (
    <article
      id={`slide-${key}`}
      aria-label={`Slide ${index + 1}: ${info.label}`}
      onFocus={onSelect}
      onPointerDown={onSelect}
      className={`scroll-mt-28 rounded-[1.75rem] bg-card p-4 ring-2 transition sm:p-5 ${
        problems.length > 0 && !selected ? "ring-red-pen/40" : selected ? "ring-ink/20" : "ring-transparent"
      }`}
    >
      <header className="flex items-center gap-3">
        <SlideThumb slide={{ ...slide, id: key }} theme={theme} sectionNumber={sectionNumber} className="aspect-video w-24 shrink-0 overflow-hidden rounded-lg ring-1 ring-ink/10" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="font-mono text-xs tabular-nums text-graphite">{String(index + 1).padStart(2, "0")}</span>
            {info.label}
            {slideTone(slide) === "accent" && <Pill tone="lime">Accent</Pill>}
          </p>
          <p className="truncate text-xs text-graphite">{slideLabel(slide) || info.description}</p>
        </div>
        {canEdit && (
          <span className="flex shrink-0 items-center">
            <SmallIcon label={`Move slide ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-4" />
            </SmallIcon>
            <SmallIcon label={`Move slide ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown className="size-4" />
            </SmallIcon>
            <SmallIcon label={`Duplicate slide ${index + 1}`} onClick={onDuplicate}>
              <Duplicate className="size-4" />
            </SmallIcon>
            <SmallIcon label={`Delete slide ${index + 1}`} disabled={total <= 1} onClick={onRemove}>
              <Trash className="size-4" />
            </SmallIcon>
          </span>
        )}
      </header>

      {canEdit && (
        <div className="mt-4 space-y-4">
          <SlideForm slide={slide} onChange={onChange} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Segmented
              label={`Slide ${index + 1} tone`}
              value={slideTone(slide)}
              options={[
                { value: "default", label: "Normal" },
                { value: "accent", label: "Accent fill" },
              ]}
              onChange={(tone) => onChange({ ...slide, tone })}
            />
            <button
              type="button"
              onClick={() => setNotesOpen((open) => !open)}
              aria-expanded={notesOpen}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-graphite transition hover:bg-panel hover:text-ink"
            >
              {notesOpen ? "Hide speaker notes" : slide.notes ? "Speaker notes" : "Add speaker notes"}
            </button>
          </div>
          {notesOpen && (
            <TextArea
              aria-label={`Slide ${index + 1} speaker notes`}
              rows={3}
              value={slide.notes ?? ""}
              onChange={(e) => onChange({ ...slide, notes: e.target.value })}
              maxLength={3000}
              placeholder="What to say on this slide. Students can open these notes too."
              className="field-sizing-content"
            />
          )}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-red-pen">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-pen" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function InsertPoint({ label, onAdd, prominent = false }: { label: string; onAdd: (type: SlideType) => void; prominent?: boolean }) {
  const items = SLIDE_TYPES.map((type) => ({
    label: SLIDE_TYPE_INFO[type].label,
    description: SLIDE_TYPE_INFO[type].description,
    onSelect: () => onAdd(type),
  }));
  return (
    <div className={`flex justify-center ${prominent ? "py-4" : "py-1.5"}`}>
      <Menu
        label={label}
        align="start"
        items={items}
        buttonClassName={
          prominent
            ? "inline-flex h-11 items-center gap-2 rounded-full border border-ink/15 bg-card px-5 text-sm font-medium transition hover:border-ink/40"
            : "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-graphite opacity-60 transition hover:bg-card hover:opacity-100 focus-visible:opacity-100"
        }
      >
        <Plus className={prominent ? "size-4" : "size-3.5"} />
        {prominent ? "Add a slide" : "Slide"}
      </Menu>
    </div>
  );
}

function VisibilityBanner({ deck }: { deck: PresentationDetail }) {
  let title: string;
  let body: string;
  let tone: string;
  if (deck.weekStatus === "draft") {
    title = "This week isn’t published yet";
    body =
      deck.status === "published"
        ? `Students see this presentation as soon as you publish “${deck.weekTitle}”.`
        : `Students see nothing in “${deck.weekTitle}” until you publish the week, which publishes this presentation too.`;
    tone = "bg-card ring-1 ring-line";
  } else if (deck.status === "published") {
    title = "Published: students see changes as soon as you save";
    body = "Fixing a typo is fine. For big rewrites, move it back to draft first.";
    tone = "bg-highlighter/45";
  } else {
    title = "Draft: students don’t see it yet";
    body = `The rest of “${deck.weekTitle}” is visible. Publish this presentation when it’s ready.`;
    tone = "bg-card ring-1 ring-line";
  }
  return (
    <div className={`mt-5 max-w-3xl rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-graphite">{body}</p>
    </div>
  );
}

function DeletePresentation({
  title,
  slideCount,
  published,
  onDelete,
  onCancel,
}: {
  title: string;
  slideCount: number;
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
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Delete this presentation?</h2>
      <p className="mt-3 text-[15px] text-graphite">
        “{title}” and its {slideCount} slide{slideCount === 1 ? "" : "s"} will be gone
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
          {busy ? "Deleting…" : "Delete presentation"}
        </Button>
      </div>
    </div>
  );
}
