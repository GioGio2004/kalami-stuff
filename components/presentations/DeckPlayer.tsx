"use client";

import { gsap } from "gsap";
import { useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { sectionNumbers, slideLabel, slideSteps, slideTone, type Deck, type DeckTheme, type Slide } from "@/lib/presentation";
import { Backdrop } from "./Backdrop";
import { choreograph, registerDeckGsap, type Choreography } from "./choreo";
import s from "./deck.module.css";
import { pad } from "./format";
import { themeStyle } from "./themes";
import { SlideView } from "./views";

/** What a page can ask the player to do. */
export type DeckPlayerHandle = { present: () => void; exit: () => void; replay: () => void };

/** How a slide comes in: playing its entrance, already built (coming back to it), or as it is. */
type Enter = "intro" | "end" | "still";
type Layer = { key: number; index: number; enter: Enter; leaving: boolean; dir: 1 | -1 };

/**
 * A presentation, played. Students watch decks with it, the staff editor
 * previews with it, and the lecturer presents with it.
 *
 * Next plays the current slide's next build (a point, a node, a code
 * highlight) and then moves on; Back plays the last build in reverse, and
 * going back a slide lands on it fully built. Moving between slides overlaps
 * two layers: the old slide rewinds its own entrance (its lines sink back
 * into their masks) while the new one plays its entrance, and the backdrop's
 * glows travel and the accent fill wipes in or out, so the deck reads as one
 * continuous space.
 *
 * Keys: → / Space / Page Down next, ← / Page Up back, Home / End, F full
 * screen, N notes, G all slides, Esc closes. Tapping the left edge goes back,
 * anywhere else goes on; on touch, swipe. Full screen uses the browser's own
 * where it can and a fixed overlay otherwise (iPhones). Reduced motion keeps
 * every step and drops the movement.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function DeckPlayer({
  ref,
  deck,
  title,
  mode = "page",
  followIndex = null,
  onIndexChange,
  onPresentingChange,
  className = "",
}: {
  ref?: Ref<DeckPlayerHandle>;
  deck: Deck;
  /** The presentation's title, for the full-screen bar and screen readers. */
  title?: string;
  /** page: a page of its own (controls under the stage, full screen, all slides). compact: the editor's side preview. */
  mode?: "page" | "compact";
  /** Show this slide whenever it changes (the editor's selected slide). */
  followIndex?: number | null;
  /** The viewer moved to another slide (not called for followIndex jumps). */
  onIndexChange?: (index: number) => void;
  /** Full screen started or ended (the browser's Esc included). */
  onPresentingChange?: (presenting: boolean) => void;
  className?: string;
}) {
  const slides = deck.slides;
  const total = slides.length;
  const reduce = useReducedMotion() ?? false;
  const presentable = mode === "page";
  const first = clampIndex(followIndex ?? 0, total);

  const [index, setIndex] = useState(first);
  const [step, setStep] = useState(0);
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, index: first, enter: "intro", leaving: false, dir: 1 }]);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [presenting, setPresenting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [idle, setIdle] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [seenFollow, setSeenFollow] = useState(followIndex);
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const press = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const sections = useMemo(() => sectionNumbers(slides), [slides]);

  const go = (to: number, dir: 1 | -1, enter: Enter, toStep: number, notify = true) => {
    if (to < 0 || to >= total) return;
    setLayers((previous) => {
      const key = previous.reduce((max, layer) => Math.max(max, layer.key), 0) + 1;
      // At most two slides on their way out; a third is dropped at once (someone is holding a key down).
      const leaving = previous.map((layer) => (layer.leaving ? layer : { ...layer, leaving: true, dir })).slice(-2);
      return [...leaving, { key, index: to, enter, leaving: false, dir }];
    });
    setIndex(to);
    setStep(toStep);
    setDirection(dir);
    setAnnouncement(`Slide ${to + 1} of ${total}: ${slideLabel(slides[to])}`);
    if (notify) onIndexChange?.(to);
  };

  // The editor selected another slide.
  if (followIndex !== seenFollow) {
    setSeenFollow(followIndex);
    if (followIndex !== null && followIndex >= 0 && followIndex < total && followIndex !== index) {
      go(followIndex, followIndex > index ? 1 : -1, "intro", 0, false);
    }
  }
  // The deck got shorter under us (a slide deleted in the editor).
  if (total > 0 && index >= total) go(total - 1, -1, "still", 0, false);

  const current = clampIndex(index, total);
  const slide: Slide | undefined = slides[current];
  const maxStep = slide ? slideSteps(slide) : 0;
  const shown = Math.min(step, maxStep);
  const atStart = current === 0 && shown === 0;
  const atEnd = current === total - 1 && shown === maxStep;

  function next() {
    if (!slide) return;
    if (shown < maxStep) setStep(shown + 1);
    else if (current < total - 1) go(current + 1, 1, "intro", 0);
  }

  function previous() {
    if (!slide) return;
    if (shown > 0) setStep(shown - 1);
    else if (current > 0) go(current - 1, -1, "end", slideSteps(slides[current - 1]));
  }

  function jump(to: number) {
    if (to === current) return;
    go(to, to > current ? 1 : -1, "intro", 0);
  }

  function replay() {
    if (slide) go(current, 1, "intro", 0);
  }

  // --- Full screen ------------------------------------------------------------------------

  const presentingChanged = useRef(onPresentingChange);
  useEffect(() => {
    presentingChanged.current = onPresentingChange;
  });

  function present() {
    if (!presentable || presenting) return;
    setPresenting(true);
    presentingChanged.current?.(true);
    const root = rootRef.current;
    if (root && document.fullscreenEnabled && root.requestFullscreen) {
      root.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    }
  }

  function exit() {
    if (!presenting) return;
    setPresenting(false);
    setIdle(false);
    presentingChanged.current?.(false);
    if (document.fullscreenElement === rootRef.current) document.exitFullscreen().catch(() => undefined);
  }

  useImperativeHandle(ref, () => ({ present, exit, replay }));

  useEffect(() => {
    if (!presenting) return;
    const onChange = () => {
      if (document.fullscreenElement !== null) return;
      setPresenting(false);
      presentingChanged.current?.(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    stageRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.body.style.overflow = overflow;
    };
  }, [presenting]);

  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // On a page of its own the deck takes the arrow keys straight away, while nothing else has focus.
  const keys = useRef<(event: KeyboardEvent<HTMLElement>) => void>(() => undefined);
  useEffect(() => {
    keys.current = onKeyDown;
  });
  useEffect(() => {
    if (mode !== "page") return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (target !== document.body && target !== document.documentElement) return;
      keys.current(event as unknown as KeyboardEvent<HTMLElement>);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  /** While presenting, the controls fade away when the pointer rests. */
  function wake() {
    if (!presenting) return;
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600);
  }

  const left = useCallback((key: number) => setLayers((all) => all.filter((layer) => layer.key !== key)), []);

  // --- Input --------------------------------------------------------------------------------

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const onControl = Boolean(target?.closest("button, a"));
    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
        next();
        break;
      case "ArrowDown":
        if (!presenting) return;
        next();
        break;
      case " ":
        if (onControl) return;
        next();
        break;
      case "ArrowLeft":
      case "PageUp":
        previous();
        break;
      case "ArrowUp":
        if (!presenting) return;
        previous();
        break;
      case "Home":
        jump(0);
        break;
      case "End":
        jump(total - 1);
        break;
      case "f":
      case "F":
        if (!presentable) return;
        if (presenting) exit();
        else present();
        break;
      case "n":
      case "N":
        setNotesOpen((open) => !open);
        break;
      case "g":
      case "G":
      case "o":
      case "O":
        if (mode === "compact") return;
        setOverview((open) => !open);
        break;
      case "Escape":
        if (overview) setOverview(false);
        else if (notesOpen && presenting) setNotesOpen(false);
        else if (presenting) exit();
        else return;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (presenting && !idle) wake();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || overview) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [data-no-advance]")) return;
    press.current = { x: event.clientX, y: event.clientY, touch: event.pointerType !== "mouse" };
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = press.current;
    press.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.touch && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) next();
      else previous();
      return;
    }
    // A drag (selecting code to copy, say) never moves the deck.
    if (Math.hypot(dx, dy) > 8) return;
    if (window.getSelection && !(window.getSelection()?.isCollapsed ?? true)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX - rect.left < rect.width * 0.28) previous();
    else next();
  }

  if (total === 0 || !slide) {
    return (
      <div className={`grid aspect-video place-items-center rounded-[1.75rem] bg-panel text-graphite ${className}`}>
        This presentation has no slides yet.
      </div>
    );
  }

  const accent = slideTone(slide) === "accent";
  const progressColor = accent ? "var(--deck-accent-fg)" : "var(--deck-strong)";
  const notes = slide.notes;

  const pill = (
    <ControlPill
      compact={mode === "compact"}
      current={current}
      total={total}
      label={slideLabel(slide)}
      atStart={atStart}
      atEnd={atEnd}
      onPrevious={previous}
      onNext={next}
      onReplay={replay}
      notesOpen={notesOpen}
      onNotes={() => setNotesOpen((open) => !open)}
      overview={mode === "page" ? { open: overview, toggle: () => setOverview((open) => !open) } : undefined}
      fullscreen={presentable ? { on: presenting, toggle: () => (presenting ? exit() : present()) } : undefined}
    />
  );

  return (
    <section
      ref={rootRef}
      aria-roledescription="presentation"
      aria-label={title ?? "Presentation"}
      onKeyDown={onKeyDown}
      style={themeStyle(deck.theme)}
      className={`${presenting ? "fixed inset-0 z-[80] bg-black" : "min-w-0"} ${className}`}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        ref={stageRef}
        data-deck-stage=""
        tabIndex={0}
        aria-label={`Slide ${current + 1} of ${total}. Arrow keys move through the presentation.`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={wake}
        className={`${s.stage} touch-pan-y outline-none focus-visible:ring-4 focus-visible:ring-highlighter/70 ${
          presenting
            ? `h-full w-full ${idle ? "cursor-none" : ""}`
            : mode === "compact"
              ? "aspect-video w-full rounded-2xl"
              : "aspect-[4/5] w-full rounded-[1.75rem] shadow-[0_40px_90px_-50px_rgba(10,10,10,0.6)] sm:aspect-video"
        }`}
      >
        <Backdrop theme={deck.theme} index={current} accent={accent} direction={direction} reduce={reduce} />
        {layers.map((layer) => {
          const shownSlide = slides[layer.index];
          if (!shownSlide) return null;
          return (
            <SlideLayer
              key={layer.key}
              layerKey={layer.key}
              slide={shownSlide}
              theme={deck.theme}
              sectionNumber={sections.get(layer.index)}
              label={`${layer.index + 1} of ${total}: ${slideLabel(shownSlide)}`}
              step={layer.leaving ? 0 : shown}
              enter={layer.enter}
              leaving={layer.leaving}
              dir={layer.dir}
              reduce={reduce}
              alone={layers.length === 1}
              onLeft={left}
            />
          );
        })}
        <div aria-hidden="true" className={s.grain} />

        {/* Progress: one segment per slide; the current one fills with its builds. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] flex h-[max(3px,0.45cqmin)] gap-[max(1px,0.25cqmin)]">
          {total <= 40 ? (
            slides.map((_, i) => (
              <span key={i} className="relative h-full flex-1 overflow-hidden" style={{ background: "color-mix(in oklab, currentColor 14%, transparent)", color: accent ? "var(--deck-accent-fg)" : "var(--deck-fg)" }}>
                <span
                  className="absolute inset-0 origin-left transition-transform duration-700 ease-out motion-reduce:transition-none"
                  style={{
                    background: progressColor,
                    transform: `scaleX(${i < current ? 1 : i === current ? (shown + 1) / (maxStep + 1) : 0})`,
                  }}
                />
              </span>
            ))
          ) : (
            <span className="relative h-full flex-1" style={{ background: "color-mix(in oklab, var(--deck-fg) 14%, transparent)" }}>
              <span
                className="absolute inset-0 origin-left transition-transform duration-700 ease-out motion-reduce:transition-none"
                style={{ background: progressColor, transform: `scaleX(${(current + 1) / total})` }}
              />
            </span>
          )}
        </div>

        {presenting && (
          <>
            <div
              className={`pointer-events-none absolute inset-x-0 top-0 z-[8] flex items-center gap-4 p-[max(12px,2.4cqmin)] transition-opacity duration-500 ${idle ? "opacity-0" : "opacity-100"}`}
            >
              <p className="min-w-0 flex-1 truncate font-mono text-[max(11px,1.4cqmin)] uppercase tracking-[0.18em]" style={{ color: accent ? "var(--deck-accent-muted)" : "var(--deck-muted)" }}>
                {title}
              </p>
              <button
                type="button"
                onClick={exit}
                className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full bg-black/55 px-4 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <CollapseIcon />
                Exit
              </button>
            </div>
            <div
              data-no-advance=""
              className={`absolute inset-x-0 bottom-[max(14px,2.6cqmin)] z-[8] flex justify-center px-4 transition-opacity duration-500 ${idle ? "pointer-events-none opacity-0" : "opacity-100"}`}
            >
              {pill}
            </div>
            {notesOpen && (
              <div
                data-no-advance=""
                className="absolute inset-x-[max(16px,6cqmin)] bottom-[max(76px,12cqmin)] z-[8] max-h-[34%] overflow-y-auto rounded-2xl bg-black/72 p-5 text-[max(15px,1.9cqmin)] leading-relaxed text-white ring-1 ring-white/10 backdrop-blur"
              >
                <NotesBody notes={notes} current={current} dark />
              </div>
            )}
          </>
        )}

        {overview && (
          <Overview
            slides={slides}
            theme={deck.theme}
            sections={sections}
            current={current}
            onPick={(i) => {
              setOverview(false);
              jump(i);
              stageRef.current?.focus({ preventScroll: true });
            }}
            onClose={() => {
              setOverview(false);
              stageRef.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>

      {!presenting && <div className={mode === "compact" ? "mt-2.5" : "mt-4"}>{pill}</div>}
      {!presenting && notesOpen && (
        <div className={`rounded-2xl bg-panel px-5 py-4 text-[15px] leading-relaxed ${mode === "compact" ? "mt-2.5" : "mt-3"}`}>
          <NotesBody notes={notes} current={current} />
        </div>
      )}
    </section>
  );
}

function clampIndex(i: number, total: number): number {
  return Math.min(Math.max(i, 0), Math.max(total - 1, 0));
}

// --- One slide on the stage ----------------------------------------------------------------

/**
 * A slide on the stage, from its entrance to its exit. Its choreography is
 * built once the fonts are in (lines are measured), rebuilt when the stage
 * changes size (full screen, a rotated phone) or the slide's words change
 * (the editor), each time landing on the step it was showing. The static
 * markup is keyed by the slide's content, so React never edits text that
 * SplitText has taken apart.
 */
function SlideLayer({
  layerKey,
  slide,
  theme,
  sectionNumber,
  label,
  step,
  enter,
  leaving,
  dir,
  reduce,
  alone,
  onLeft,
}: {
  layerKey: number;
  slide: Slide;
  theme: DeckTheme;
  sectionNumber?: number;
  label: string;
  step: number;
  enter: Enter;
  leaving: boolean;
  dir: 1 | -1;
  reduce: boolean;
  alone: boolean;
  onLeft: (key: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef<{ c: Choreography; mover: gsap.core.Animation | null; step: number } | null>(null);
  const wanted = useRef(step);
  const builtOnce = useRef(false);
  const content = useMemo(() => `${theme}|${sectionNumber ?? 0}|${JSON.stringify(slide)}`, [slide, theme, sectionNumber]);

  useEffect(() => {
    wanted.current = step;
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    registerDeckGsap();
    let alive = true;
    let ctx: gsap.Context | null = null;
    let restore: (() => void) | null = null;
    let size = { w: 0, h: 0 };
    let timer: number | undefined;

    const build = () => {
      if (!alive) return;
      const again = builtOnce.current;
      builtOnce.current = true;
      live.current?.mover?.kill();
      ctx?.revert();
      restore?.();
      const holder: { c: Choreography | null } = { c: null };
      ctx = gsap.context(() => {
        holder.c = choreograph(slide, root);
      }, root);
      const c = holder.c as Choreography | null;
      if (!c) return;
      restore = c.restore;
      const at = Math.min(wanted.current, c.labels.length - 1);
      const entry: { c: Choreography; mover: gsap.core.Animation | null; step: number } = { c, mover: null, step: at };
      live.current = entry;
      size = { w: root.clientWidth, h: root.clientHeight };
      const unit = Math.min(size.w, size.h) / 100;
      ctx.add(() => {
        gsap.set(root, { visibility: "visible" });
        if (!again && enter === "intro" && !reduce) {
          // Wait a beat while the slide before rewinds, unless this is the first slide on the stage.
          entry.mover = c.tl.tweenTo(c.labels[at], { delay: alone ? 0.1 : 0.32 });
          return;
        }
        c.tl.seek(c.labels[at], false);
        if (!again && enter === "end" && !reduce) {
          gsap.fromTo(root, { opacity: 0, y: -2.4 * unit }, { opacity: 1, y: 0, duration: 0.7, delay: 0.2, ease: "deck-out" });
        } else if (!again && reduce) {
          gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 });
        }
      });
    };

    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts || fonts.status === "loaded") build();
    else fonts.ready.then(build, build);

    const observer = new ResizeObserver(() => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (!live.current || (Math.abs(w - size.w) < 2 && Math.abs(h - size.h) < 2)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(build, 160);
    });
    observer.observe(root);

    return () => {
      alive = false;
      observer.disconnect();
      window.clearTimeout(timer);
      live.current?.mover?.kill();
      ctx?.revert();
      restore?.();
      live.current = null;
    };
    // `content` stands for the slide (and its theme and number); enter, alone and dir only matter on the first build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, reduce]);

  // Next and Back within the slide: play to the step's label, or back to it a little faster.
  useEffect(() => {
    const entry = live.current;
    if (!entry || leaving) return;
    const at = Math.min(step, entry.c.labels.length - 1);
    if (at === entry.step) return;
    entry.mover?.kill();
    const target = entry.c.labels[at];
    if (reduce) {
      entry.c.tl.seek(target, false);
    } else {
      const now = entry.c.tl.time();
      const to = entry.c.tl.labels[target] ?? 0;
      entry.mover = to < now ? entry.c.tl.tweenTo(target, { duration: Math.max(0.3, (now - to) * 0.45), ease: "power2.inOut" }) : entry.c.tl.tweenTo(target);
    }
    entry.step = at;
  }, [step, reduce, leaving]);

  // On its way out: the slide rewinds its entrance while it fades, then it's gone.
  useEffect(() => {
    if (!leaving) return;
    const root = ref.current;
    const entry = live.current;
    entry?.mover?.kill();
    if (!root) {
      onLeft(layerKey);
      return;
    }
    const running: gsap.core.Animation[] = [];
    const unit = Math.min(root.clientWidth, root.clientHeight) / 100;
    if (reduce || !entry) {
      running.push(gsap.to(root, { opacity: 0, duration: 0.2, onComplete: () => onLeft(layerKey) }));
    } else {
      const d = Math.min(0.62, Math.max(0.34, entry.c.tl.time() / 3));
      running.push(entry.c.tl.tweenTo(0, { duration: d, ease: "power2.in" }));
      running.push(
        gsap.to(root, {
          opacity: 0,
          y: -dir * 1.6 * unit,
          filter: "blur(6px)",
          duration: d * 0.9,
          delay: d * 0.25,
          ease: "power2.in",
          onComplete: () => onLeft(layerKey),
        }),
      );
    }
    return () => {
      for (const animation of running) animation.kill();
    };
  }, [leaving, dir, reduce, layerKey, onLeft]);

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={leaving || undefined}
      className={s.layer}
      style={{ visibility: "hidden", zIndex: leaving ? 2 : 3 }}
    >
      <SlideView key={content} slide={slide} theme={theme} sectionNumber={sectionNumber} />
    </div>
  );
}

// --- Chrome --------------------------------------------------------------------------------

function ControlPill({
  compact,
  current,
  total,
  label,
  atStart,
  atEnd,
  onPrevious,
  onNext,
  onReplay,
  notesOpen,
  onNotes,
  overview,
  fullscreen,
}: {
  compact: boolean;
  current: number;
  total: number;
  label: string;
  atStart: boolean;
  atEnd: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onReplay: () => void;
  notesOpen: boolean;
  onNotes: () => void;
  overview?: { open: boolean; toggle: () => void };
  fullscreen?: { on: boolean; toggle: () => void };
}) {
  const size = compact ? "size-9" : "size-11";
  return (
    <div
      data-no-advance=""
      className={`@container mx-auto flex w-full items-center gap-1 rounded-full bg-ink text-paper shadow-xl shadow-ink/20 ring-1 ring-paper/10 ${
        compact ? "max-w-full p-1" : "max-w-3xl p-1.5"
      }`}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={atStart}
        aria-label="Previous"
        className={`grid ${size} shrink-0 place-items-center rounded-full transition enabled:hover:bg-paper/10 disabled:opacity-35 ${focusRing}`}
      >
        <ArrowIcon back />
      </button>
      <p className={`min-w-0 flex-1 truncate px-1.5 tabular-nums ${compact ? "text-xs" : "text-sm"}`}>
        <span className="font-medium">{pad(current + 1)}</span>
        <span className="text-paper/50"> / {pad(total)}</span>
        <span className="hidden text-paper/60 @md:inline"> · {label}</span>
      </p>
      <ChromeButton size={size} label="Replay this slide" onClick={onReplay}>
        <ReplayIcon />
      </ChromeButton>
      <ChromeButton size={size} label={notesOpen ? "Hide notes" : "Speaker notes"} pressed={notesOpen} onClick={onNotes}>
        <NotesIcon />
      </ChromeButton>
      {overview && (
        <ChromeButton size={size} label="All slides" pressed={overview.open} onClick={overview.toggle}>
          <GridIcon />
        </ChromeButton>
      )}
      {fullscreen && (
        <ChromeButton size={size} label={fullscreen.on ? "Exit full screen" : "Present full screen"} onClick={fullscreen.toggle}>
          {fullscreen.on ? <CollapseIcon /> : <ExpandIcon />}
        </ChromeButton>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={atEnd}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-highlighter font-medium text-ink transition enabled:hover:brightness-95 disabled:opacity-35 ${focusRing} ${
          compact ? "h-9 px-3 text-xs" : "h-11 px-4 text-sm"
        }`}
      >
        <span className="hidden @xs:inline">Next</span>
        <ArrowIcon />
      </button>
    </div>
  );
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter";

function ChromeButton({
  size,
  label,
  pressed,
  onClick,
  children,
}: {
  size: string;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`hidden ${size} shrink-0 place-items-center rounded-full transition hover:bg-paper/10 @sm:grid ${pressed ? "bg-paper/15 text-highlighter" : "text-paper/80"} ${focusRing}`}
    >
      {children}
    </button>
  );
}

function NotesBody({ notes, current, dark = false }: { notes?: string; current: number; dark?: boolean }) {
  return (
    <>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${dark ? "text-white/60" : "text-graphite"}`}>
        Speaker notes · slide {current + 1}
      </p>
      <p className={`mt-2 whitespace-pre-wrap ${notes ? "" : dark ? "text-white/60" : "text-graphite"}`}>{notes ?? "No notes on this slide."}</p>
    </>
  );
}

function Overview({
  slides,
  theme,
  sections,
  current,
  onPick,
  onClose,
}: {
  slides: Slide[];
  theme: DeckTheme;
  sections: Map<number, number>;
  current: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.focus({ preventScroll: false });
  }, []);
  return (
    <div
      data-no-advance=""
      role="dialog"
      aria-label="All slides"
      className="absolute inset-0 z-[9] overflow-y-auto overscroll-contain p-[max(14px,3cqmin)]"
      style={{ background: "color-mix(in oklab, var(--deck-bg) 94%, transparent)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}
    >
      <div className="mb-[max(10px,2cqmin)] flex items-center justify-between gap-4">
        <p className={s.kicker}>
          <span aria-hidden="true" className={s.kickerDot} />
          All slides
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium"
          style={{ color: "var(--deck-fg)", boxShadow: "inset 0 0 0 1px var(--deck-line)" }}
        >
          Close
        </button>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-[max(10px,2cqmin)]">
        {slides.map((slide, i) => (
          <li key={slide.id || i}>
            <button
              ref={i === current ? currentRef : undefined}
              type="button"
              onClick={() => onPick(i)}
              aria-current={i === current ? "true" : undefined}
              className="group block w-full rounded-xl text-left outline-none"
            >
              <span
                className="block overflow-hidden rounded-xl transition group-focus-visible:ring-4"
                style={{ boxShadow: i === current ? "0 0 0 2px var(--deck-strong)" : "0 0 0 1px var(--deck-line)" }}
              >
                <SlideThumb slide={slide} theme={theme} sectionNumber={sections.get(i)} className="aspect-video w-full" />
              </span>
              <span className="mt-1.5 flex gap-2 text-xs" style={{ color: "var(--deck-muted)" }}>
                <span className="font-mono tabular-nums">{pad(i + 1)}</span>
                <span className="truncate">{slideLabel(slide)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A slide as a still picture: the overview, the editor's slide list. */
export function SlideThumb({
  slide,
  theme,
  sectionNumber,
  className = "",
}: {
  slide: Slide;
  theme: DeckTheme;
  sectionNumber?: number;
  className?: string;
}) {
  const accent = slideTone(slide) === "accent";
  return (
    <span
      aria-hidden="true"
      data-deck-stage=""
      className={`${s.stage} ${s.thumb} block ${className}`}
      style={{ ...themeStyle(theme), background: accent ? "var(--deck-accent-bg)" : "var(--deck-bg)" }}
    >
      <SlideView slide={slide} theme={theme} sectionNumber={sectionNumber} />
    </span>
  );
}

// --- Icons ---------------------------------------------------------------------------------

function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`size-4 ${back ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 10h11M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5" />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM7 7.5h6M7 10.5h6M7 13.5h3.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5V8H3.5M12 3.5V8h4.5M16.5 12H12v4.5M3.5 12H8v4.5" />
    </svg>
  );
}
