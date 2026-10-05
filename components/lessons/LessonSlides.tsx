"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Block, blockIsProse, blockKindLabel } from "./LessonBlocks";
import { resolveSlideIndex, slideKeyAction, slideStateKey } from "./slides";
import type { LessonBlock } from "./types";

/** What a page can ask the player to do: open or close the presenter view. */
export type LessonSlidesHandle = { present: () => void; exit: () => void };

/** Fields and editable things: a letter typed there must stay a letter. */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

/**
 * A lesson as slides: one block per slide, in order, one slide at a time.
 * Students read lessons with it and the staff editor previews with it, so both
 * see the same thing.
 *
 * Moving on is always the reader's choice: Previous and Next (disabled at the
 * ends, no wrapping), or ← and → while focus is in the player. A slide is
 * mounted the first time it's shown and then kept, hidden, so answers and
 * revealed steps are still there on the way back; a video is unmounted when
 * its slide is left, which stops it.
 *
 * Present (the button, `F`, or the page through `ref`) takes the player over
 * the whole screen: the browser's fullscreen where it allows it, a fixed
 * overlay otherwise (so phones get it too), bigger type, the same slides and
 * controls, Esc or Exit to come back. Nothing remounts, so answers survive.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function LessonSlides({
  ref,
  blocks,
  followId = null,
  onNavigate,
  renderBlock = defaultRender,
  compact = false,
  presentable = !compact,
  empty,
  label = "Lesson",
  title,
  className = "",
}: {
  ref?: Ref<LessonSlidesHandle>;
  blocks: LessonBlock[];
  /** Jump to this block whenever it changes: the editor's selected block. */
  followId?: string | null;
  /** The reader moved to another slide (buttons or keys); not called for followId jumps. */
  onNavigate?: (blockId: string) => void;
  /** How a block renders; the editor passes one that explains unfinished blocks. */
  renderBlock?: (block: LessonBlock) => ReactNode;
  /** The editor's narrow side preview: the slide scrolls inside the panel and the controls stay put. */
  compact?: boolean;
  /** Offer the full-screen presenter (never in the compact preview). */
  presentable?: boolean;
  /** Shown instead of the player when there are no blocks. */
  empty?: ReactNode;
  /** What the player is called for screen readers. */
  label?: string;
  /** The lesson's title, on the presenter's top bar. */
  title?: string;
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(() =>
    followId !== null && blocks.some((b) => b.id === followId) ? followId : (blocks[0]?.id ?? null),
  );
  const [lastIndex, setLastIndex] = useState(0);
  const [seenFollowId, setSeenFollowId] = useState(followId);
  // Slides shown so far, kept mounted (hidden) so their state survives.
  const [mounted, setMounted] = useState<string[]>([]);
  // Which side the next slide comes in from; nothing slides in on the first render.
  const [direction, setDirection] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [presenting, setPresenting] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Set when focus would be lost with the slide that's leaving (or with a button that gets disabled).
  const refocus = useRef(false);
  const navigated = useRef(false);
  const reduce = useReducedMotion();

  let index = resolveSlideIndex(blocks, activeId, lastIndex);

  // The editor selected another block: show its slide.
  if (followId !== seenFollowId) {
    setSeenFollowId(followId);
    const to = followId === null ? -1 : blocks.findIndex((b) => b.id === followId);
    if (to !== -1 && to !== index) {
      setDirection(Math.sign(to - index));
      setActiveId(followId);
      index = to;
    }
  }
  if (index !== -1 && index !== lastIndex) setLastIndex(index);
  const active = index === -1 ? undefined : blocks[index];
  // The active block was deleted: its neighbour is the active one now.
  if (active && active.id !== activeId) setActiveId(active.id);
  if (active && !mounted.includes(active.id)) setMounted([...mounted, active.id]);

  function goTo(to: number) {
    if (to < 0 || to >= blocks.length || to === index) return;
    const focused = document.activeElement;
    refocus.current =
      (stageRef.current?.contains(focused) ?? false) ||
      (to === 0 && focused === prevRef.current) ||
      (to === blocks.length - 1 && focused === nextRef.current);
    navigated.current = true;
    setDirection(Math.sign(to - index));
    setActiveId(blocks[to].id);
    setLastIndex(to);
    setAnnouncement(`Slide ${to + 1} of ${blocks.length}`);
    onNavigate?.(blocks[to].id);
  }

  // --- Presenting -----------------------------------------------------------------------

  function present() {
    if (!presentable || presenting) return;
    setPresenting(true);
    refocus.current = true;
    // The browser's own fullscreen where it allows it (not on iPhones); the overlay works regardless.
    const root = rootRef.current;
    if (root && document.fullscreenEnabled && root.requestFullscreen) {
      root.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    }
  }

  function exit() {
    if (!presenting) return;
    setPresenting(false);
    refocus.current = true;
    if (document.fullscreenElement === rootRef.current) {
      document.exitFullscreen().catch(() => undefined);
    }
  }

  useImperativeHandle(ref, () => ({ present, exit }));

  // Leaving the browser's fullscreen (Esc, the browser's own control) leaves the presenter too.
  useEffect(() => {
    if (!presenting) return;
    function onChange() {
      if (document.fullscreenElement === null) setPresenting(false);
    }
    document.addEventListener("fullscreenchange", onChange);
    // The page behind the overlay must not scroll along.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.body.style.overflow = previous;
    };
  }, [presenting]);

  // After a move (or entering/leaving the presenter): keep focus in the player, and bring the new slide's start into view.
  const activeKey = active?.id;
  useEffect(() => {
    if (activeKey === undefined) return;
    if (refocus.current) {
      refocus.current = false;
      stageRef.current?.querySelector<HTMLElement>("[data-active]")?.focus({ preventScroll: true });
    }
    if (!navigated.current) return;
    navigated.current = false;
    if (compact || presenting) {
      stageRef.current?.scrollTo({ top: 0 });
    } else if (rootRef.current && rootRef.current.getBoundingClientRect().top < 0) {
      rootRef.current.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [activeKey, compact, presenting, reduce]);

  if (blocks.length === 0 || index === -1) {
    return <>{empty ?? <p className="text-[17px] text-graphite">This lesson is empty for now.</p>}</>;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (presenting && event.key === "Escape") {
      event.preventDefault();
      exit();
      return;
    }
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (presentable && plain && (event.key === "f" || event.key === "F") && target?.closest(TYPING) === null) {
      event.preventDefault();
      if (presenting) exit();
      else present();
      return;
    }
    const action = slideKeyAction({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      defaultPrevented: event.defaultPrevented,
      target,
    });
    if (action === null) return;
    event.preventDefault();
    goTo(action === "next" ? index + 1 : index - 1);
  }

  const total = blocks.length;
  const offset = reduce ? 0 : 28;
  const ease = [0.22, 1, 0.36, 1] as const;
  const counter = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;

  const controls = (
    <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-1.5 rounded-full bg-ink p-1.5 text-paper shadow-xl shadow-ink/20 ring-1 ring-paper/10">
      <StepButton ref={prevRef} direction="previous" disabled={index === 0} onClick={() => goTo(index - 1)} />
      <div className="min-w-0 flex-1 px-2">
        <p className="truncate text-center text-sm tabular-nums">
          <span className="font-medium">{index + 1}</span>
          <span className="text-paper/50"> / {total}</span>
        </p>
        <div aria-hidden="true" className="mx-auto mt-1 flex h-1 max-w-56 gap-0.5">
          {total <= 20 ? (
            blocks.map((block, i) => (
              <span
                key={block.id}
                className={`h-full flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                  i <= index ? "bg-highlighter" : "bg-paper/15"
                }`}
              />
            ))
          ) : (
            <span className="h-full flex-1 overflow-hidden rounded-full bg-paper/15">
              <span
                className="block h-full rounded-full bg-highlighter transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${((index + 1) / total) * 100}%` }}
              />
            </span>
          )}
        </div>
      </div>
      {presentable && (
        <button
          type="button"
          onClick={() => (presenting ? exit() : present())}
          aria-label={presenting ? "Exit full screen" : "Present full screen"}
          title={presenting ? "Exit full screen (Esc)" : "Full screen (F)"}
          className="grid size-11 shrink-0 place-items-center rounded-full text-paper/80 transition hover:bg-paper/10 hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter"
        >
          {presenting ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      )}
      <StepButton ref={nextRef} direction="next" disabled={index === total - 1} onClick={() => goTo(index + 1)} />
    </div>
  );

  return (
    <section
      ref={rootRef}
      aria-roledescription="slides"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`@container min-w-0 scroll-mt-28 ${
        presenting
          ? "fixed inset-0 z-[70] flex flex-col bg-paper text-[1.125rem]"
          : compact
            ? "flex min-h-0 flex-col"
            : ""
      } ${className}`}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {presenting && (
        <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3 text-base sm:px-8">
          <p className="min-w-0 flex-1 truncate font-medium tracking-tight">{title ?? label}</p>
          <p className="hidden text-sm text-graphite sm:block">← → to move · Esc to leave</p>
          <button
            type="button"
            onClick={exit}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-ink/15 px-4 text-sm font-medium transition hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <CollapseIcon />
            Exit
          </button>
        </header>
      )}

      <div
        ref={stageRef}
        className={
          compact
            ? "min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            : presenting
              ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
              : ""
        }
      >
        <div className={presenting ? "mx-auto flex min-h-full w-full max-w-[84rem] flex-col justify-center px-4 py-6 sm:px-8" : ""}>
          {blocks.map((block, i) => {
            const isActive = i === index;
            if (!isActive && !mounted.includes(block.id)) return null;
            const prose = blockIsProse(block);
            return (
              <motion.div
                key={block.id}
                hidden={!isActive}
                data-active={isActive ? "" : undefined}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${total}`}
                tabIndex={isActive ? 0 : -1}
                initial={direction === 0 ? false : { opacity: 0, x: direction * offset }}
                animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: (i < index ? -1 : 1) * offset }}
                transition={isActive ? { duration: 0.3, ease } : { duration: 0 }}
                className={`relative flex min-w-0 flex-col bg-card outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                  compact
                    ? "rounded-3xl p-4 ring-1 ring-line"
                    : presenting
                      ? "min-h-[min(40rem,calc(100dvh-13rem))] rounded-[2.5rem] px-6 py-10 ring-1 ring-line sm:px-16 sm:py-14"
                      : "min-h-[min(36rem,70dvh)] rounded-[2.25rem] px-5 py-8 shadow-[0_30px_80px_-55px_rgba(20,20,20,0.45)] ring-1 ring-line sm:rounded-[2.5rem] sm:px-12 sm:py-12"
                }`}
              >
                {!compact && (
                  <div className="mb-6 flex items-center justify-between gap-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-graphite sm:mb-8">
                    <span className="font-mono tabular-nums">{counter}</span>
                    <span className="truncate">{blockKindLabel(block)}</span>
                  </div>
                )}
                <div className={`flex min-w-0 flex-1 flex-col justify-center ${compact ? "" : "py-1"}`}>
                  <div key={slideStateKey(block)} className={`min-w-0 ${!compact && prose ? "mx-auto w-full max-w-[46rem]" : ""}`}>
                    {/* A video only exists while its slide is shown, so leaving the slide stops it. */}
                    {block.type === "video" && !isActive ? null : renderBlock(block)}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <nav
        aria-label="Slides"
        className={
          compact
            ? "mt-3"
            : presenting
              ? "flex shrink-0 justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
              : "pointer-events-none sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 mt-5 flex justify-center sm:bottom-[calc(1.25rem+env(safe-area-inset-bottom))]"
        }
      >
        {controls}
      </nav>
      {!compact && !presenting && (
        <p className="mt-3 hidden text-center text-xs text-graphite @3xl:block" aria-hidden="true">
          ← → to move between slides{presentable ? " · F for full screen" : ""}
        </p>
      )}
    </section>
  );
}

function defaultRender(block: LessonBlock) {
  return <Block block={block} />;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-[1.1rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-[1.1rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5V8H3.5M12 3.5V8h4.5M16.5 12H12v4.5M3.5 12H8v4.5" />
    </svg>
  );
}

function StepButton({
  ref,
  direction,
  disabled,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>;
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const next = direction === "next";
  return (
    <button
      ref={ref}
      type="button"
      aria-label={next ? "Next slide" : "Previous slide"}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter disabled:cursor-default disabled:opacity-35 @xs:px-4 ${
        next
          ? "flex-row-reverse bg-highlighter text-ink enabled:hover:brightness-95"
          : "text-paper enabled:hover:bg-paper/10"
      }`}
    >
      <svg viewBox="0 0 20 20" aria-hidden className={`size-4 ${next ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 10h11M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="hidden @xs:inline">{next ? "Next" : "Previous"}</span>
    </button>
  );
}
