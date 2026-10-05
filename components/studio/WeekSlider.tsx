"use client";

import { motion, useDragControls } from "motion/react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import type { OutlineWeek, WeekId } from "./types";

// The outline shows one week at a time: a row of numbered chips picks it, and
// the week itself can be stepped through with arrows, keys or a swipe.

export const WEEK_PANEL_ID = "outline-week-panel";
const tabId = (id: WeekId) => `week-tab-${id}`;

const roundButton =
  "grid size-10 shrink-0 place-items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Every week as a numbered chip (dark once published); ←/→, Home and End move along it. */
export function WeekIndex({
  weeks,
  selectedId,
  onSelect,
}: {
  weeks: OutlineWeek[];
  selectedId: WeekId;
  onSelect: (id: WeekId) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const index = weeks.findIndex((w) => w._id === selectedId);

  // Keep the chosen chip in view inside the strip, without scrolling the page.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({
      left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectedId]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: weeks.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const week = weeks[Math.max(0, Math.min(weeks.length - 1, target))];
    onSelect(week._id);
    document.getElementById(tabId(week._id))?.focus();
  }

  return (
    <div className="flex items-center gap-1">
      <StepArrow direction="prev" disabled={index <= 0} onClick={() => onSelect(weeks[index - 1]._id)} />
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Weeks"
        onKeyDown={onKeyDown}
        className="no-scrollbar relative flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto p-1.5"
      >
        {weeks.map((week, i) => {
          const selected = week._id === selectedId;
          const published = week.status === "published";
          return (
            <button
              key={week._id}
              id={tabId(week._id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? WEEK_PANEL_ID : undefined}
              aria-label={`${week.title}, ${published ? "published" : "draft"}`}
              title={week.title}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(week._id)}
              className={`${roundButton} snap-center text-sm font-semibold tabular-nums ${
                published ? "bg-ink text-highlighter hover:bg-ink/85" : "bg-panel text-ink hover:bg-panel-strong"
              } ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-card" : ""}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <StepArrow direction="next" disabled={index >= weeks.length - 1} onClick={() => onSelect(weeks[index + 1]._id)} />
    </div>
  );
}

function StepArrow({ direction, disabled, onClick }: { direction: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "Previous week" : "Next week"}
      disabled={disabled}
      onClick={onClick}
      className={`${roundButton} text-ink hover:bg-panel disabled:pointer-events-none disabled:opacity-25`}
    >
      <ChevronDown className={`size-5 ${direction === "prev" ? "rotate-90" : "-rotate-90"}`} />
    </button>
  );
}

/**
 * The chosen week. It slides in from the side it came from, and on a touch
 * screen a sideways swipe moves to the next or previous week. Give it a key
 * per week so each one slides in fresh.
 */
export function WeekPanel({
  weekId,
  direction,
  onPrev,
  onNext,
  children,
}: {
  weekId: WeekId;
  /** -1 when stepping back, 1 when stepping forward, 0 for no slide. */
  direction: number;
  onPrev?: () => void;
  onNext?: () => void;
  children: ReactNode;
}) {
  const drag = useDragControls();
  return (
    <motion.div
      id={WEEK_PANEL_ID}
      role="tabpanel"
      aria-labelledby={tabId(weekId)}
      className="scroll-mt-28"
      style={{ touchAction: "pan-y pinch-zoom" }}
      initial={{ opacity: 0, x: direction * 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      // Swiping is for fingers and pens; with a mouse, dragging would get in the way of selecting text.
      drag="x"
      dragListener={false}
      dragControls={drag}
      dragDirectionLock
      dragSnapToOrigin
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.25}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse") drag.start(event);
      }}
      onDragEnd={(_, info) => {
        const swipe = info.offset.x + info.velocity.x * 0.2;
        if (swipe < -80) onNext?.();
        else if (swipe > 80) onPrev?.();
      }}
    >
      {children}
    </motion.div>
  );
}

/** "Previous" and "Next" under the week, with the neighbours' names. */
export function WeekSteps({
  prev,
  next,
  onSelect,
}: {
  prev?: OutlineWeek;
  next?: OutlineWeek;
  onSelect: (id: WeekId) => void;
}) {
  return (
    <nav aria-label="Other weeks" className="grid grid-cols-2 gap-3">
      {prev && <Step week={prev} direction="prev" onSelect={onSelect} />}
      {next && <Step week={next} direction="next" onSelect={onSelect} />}
    </nav>
  );
}

function Step({ week, direction, onSelect }: { week: OutlineWeek; direction: "prev" | "next"; onSelect: (id: WeekId) => void }) {
  const isNext = direction === "next";
  return (
    <button
      type="button"
      onClick={() => onSelect(week._id)}
      className={`group flex min-w-0 items-center gap-3 rounded-[1.5rem] bg-card px-3 py-3 transition hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:px-4 ${
        isNext ? "col-start-2 flex-row-reverse text-right" : "text-left"
      }`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-panel transition group-hover:bg-highlighter">
        <ChevronDown className={`size-5 ${isNext ? "-rotate-90" : "rotate-90"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-graphite">{isNext ? "Next week" : "Previous week"}</span>
        <span className="block truncate text-sm font-medium">{week.title}</span>
      </span>
    </button>
  );
}
