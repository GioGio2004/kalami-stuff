"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Block } from "./LessonBlocks";
import { resolveSlideIndex, slideKeyAction, slideStateKey } from "./slides";
import type { LessonBlock } from "./types";

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
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function LessonSlides({
  blocks,
  followId = null,
  onNavigate,
  renderBlock = defaultRender,
  compact = false,
  empty,
  label = "Lesson",
  className = "",
}: {
  blocks: LessonBlock[];
  /** Jump to this block whenever it changes: the editor's selected block. */
  followId?: string | null;
  /** The reader moved to another slide (buttons or keys); not called for followId jumps. */
  onNavigate?: (blockId: string) => void;
  /** How a block renders; the editor passes one that explains unfinished blocks. */
  renderBlock?: (block: LessonBlock) => ReactNode;
  /** The editor's narrow side preview: the slide scrolls inside the panel and the controls stay put. */
  compact?: boolean;
  /** Shown instead of the player when there are no blocks. */
  empty?: ReactNode;
  /** What the player is called for screen readers. */
  label?: string;
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

  // After a move: keep focus in the player, and bring the new slide's start into view.
  const activeKey = active?.id;
  useEffect(() => {
    if (activeKey === undefined) return;
    if (refocus.current) {
      refocus.current = false;
      stageRef.current?.querySelector<HTMLElement>("[data-active]")?.focus({ preventScroll: true });
    }
    if (!navigated.current) return;
    navigated.current = false;
    if (compact) {
      stageRef.current?.scrollTo({ top: 0 });
    } else if (rootRef.current && rootRef.current.getBoundingClientRect().top < 0) {
      rootRef.current.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [activeKey, compact, reduce]);

  if (blocks.length === 0 || index === -1) {
    return <>{empty ?? <p className="text-[17px] text-graphite">This lesson is empty for now.</p>}</>;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const action = slideKeyAction({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      defaultPrevented: event.defaultPrevented,
      target: event.target instanceof Element ? event.target : null,
    });
    if (action === null) return;
    event.preventDefault();
    goTo(action === "next" ? index + 1 : index - 1);
  }

  const total = blocks.length;
  const offset = reduce ? 0 : 28;
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <section
      ref={rootRef}
      aria-roledescription="slides"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`@container min-w-0 scroll-mt-28 ${compact ? "flex min-h-0 flex-col" : ""} ${className}`}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div ref={stageRef} className={compact ? "min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" : ""}>
        {blocks.map((block, i) => {
          const isActive = i === index;
          if (!isActive && !mounted.includes(block.id)) return null;
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
              className={`flex min-w-0 flex-col justify-center rounded-[2rem] bg-card ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                compact ? "rounded-3xl p-4" : "min-h-[min(26rem,55dvh)] px-5 py-8 sm:px-10 sm:py-10"
              }`}
            >
              <div key={slideStateKey(block)} className="min-w-0">
                {/* A video only exists while its slide is shown, so leaving the slide stops it. */}
                {block.type === "video" && !isActive ? null : renderBlock(block)}
              </div>
            </motion.div>
          );
        })}
      </div>

      <nav
        aria-label="Slides"
        className={compact ? "mt-3" : "pointer-events-none sticky bottom-3 z-10 mt-4 flex justify-center sm:bottom-5"}
      >
        <div className="pointer-events-auto flex w-full max-w-xl items-center gap-1.5 rounded-full bg-ink p-1.5 text-paper shadow-xl shadow-ink/15">
          <StepButton ref={prevRef} direction="previous" disabled={index === 0} onClick={() => goTo(index - 1)} />
          <div className="min-w-0 flex-1 px-1 text-center">
            <p className="truncate text-sm font-medium tabular-nums">
              Slide {index + 1} of {total}
            </p>
            <div aria-hidden className="mx-auto mt-1 h-1 max-w-32 overflow-hidden rounded-full bg-paper/15">
              <div
                className="h-full rounded-full bg-highlighter transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${((index + 1) / total) * 100}%` }}
              />
            </div>
          </div>
          <StepButton ref={nextRef} direction="next" disabled={index === total - 1} onClick={() => goTo(index + 1)} />
        </div>
      </nav>
    </section>
  );
}

function defaultRender(block: LessonBlock) {
  return <Block block={block} />;
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
