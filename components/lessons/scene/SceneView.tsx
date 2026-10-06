"use client";

import { gsap } from "gsap";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SCENE_STAGE, type Scene, type SceneElement } from "@/lib/scene";
import { ArrowLayer, StageElement } from "./elements";
import { buildSceneTimeline, type SceneTimeline } from "./timeline";

/**
 * An animated scene as students play it: the stage, scaled to the width it
 * gets, with Back and Next under it and a caption for the current step. Next
 * plays the next step's animations; Back plays the last one in reverse, so a
 * student can always see a step again. The slide player (LessonSlides) sends
 * ← and → here through the `data-stepper` buttons while a step remains, and
 * moves slides once the scene is done. Tapping the stage also moves on.
 *
 * With reduced motion the steps still apply, instantly.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function SceneView({ scene, compact = false }: { scene: Scene; compact?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const timeline = useRef<SceneTimeline | null>(null);
  const moving = useRef<gsap.core.Tween | null>(null);
  const [scale, setScale] = useState(0);
  const [width, setWidth] = useState(0);
  const [step, setStep] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const reduce = useReducedMotion();
  const total = scene.steps.length;
  const theme = scene.theme ?? "paper";
  // The editor changes a scene while it's shown: a new timeline for each version, keeping the step.
  const version = useMemo(() => JSON.stringify(scene), [scene]);

  // The stage keeps its aspect and scales as a whole to the width it has.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const w = frame.clientWidth;
      setWidth(w);
      setScale(w / SCENE_STAGE.width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const camera = cameraRef.current;
    if (!stage || !camera) return;
    const context = gsap.context(() => {
      const built = buildSceneTimeline(scene, stage, camera);
      timeline.current = built;
      // Back where the student was (or the end, if the scene got shorter).
      const at = Math.min(step, built.labels.length - 1);
      built.tl.seek(built.labels[at], false);
      if (at !== step) setStep(at);
    }, stage);
    return () => {
      moving.current?.kill();
      moving.current = null;
      timeline.current = null;
      context.revert();
    };
    // `version` is the scene; `step` is read only to restore it on a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function go(to: number) {
    const built = timeline.current;
    if (!built || to < 0 || to > total || to === step) return;
    moving.current?.kill();
    if (reduce) {
      built.tl.seek(built.labels[to], false);
      moving.current = null;
    } else {
      moving.current = built.tl.tweenTo(built.labels[to], { ease: "none", overwrite: true });
    }
    setStep(to);
    const note = scene.steps[to - 1]?.note;
    setAnnouncement(to === 0 ? "Scene reset." : `Step ${to} of ${total}.${note ? ` ${note}` : ""}`);
  }

  const arrows = scene.elements.filter((e): e is Extract<SceneElement, { kind: "arrow" }> => e.kind === "arrow");
  const placed = scene.elements.filter((e): e is Exclude<SceneElement, { kind: "arrow" }> => e.kind !== "arrow");
  const note = step === 0 ? (scene.title ?? "") : (scene.steps[step - 1]?.note ?? "");
  const narrow = width > 0 && width < 520;

  return (
    <figure className="min-w-0" aria-roledescription="animated scene" aria-label={scene.title ?? "Animated scene"}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        ref={frameRef}
        onClick={() => go(step + 1)}
        className={`relative w-full select-none overflow-hidden rounded-[1.6rem] ring-1 ${
          theme === "ink" ? "bg-ink ring-ink" : "bg-paper ring-ink/10"
        } ${step < total ? "cursor-pointer" : ""}`}
        style={{ aspectRatio: `${SCENE_STAGE.width} / ${SCENE_STAGE.height}` }}
      >
        <div
          ref={stageRef}
          className="absolute left-0 top-0 origin-top-left overflow-hidden"
          style={{
            width: SCENE_STAGE.width,
            height: SCENE_STAGE.height,
            transform: `scale(${scale})`,
            visibility: scale === 0 ? "hidden" : undefined,
            backgroundImage:
              theme === "ink"
                ? "radial-gradient(color-mix(in oklab, var(--paper) 14%, transparent) 1.5px, transparent 1.5px)"
                : "radial-gradient(color-mix(in oklab, var(--ink) 9%, transparent) 1.5px, transparent 1.5px)",
            backgroundSize: "32px 32px",
            backgroundPosition: "16px 16px",
          }}
        >
          <div ref={cameraRef} className="relative size-full origin-top-left will-change-transform">
            {placed.map((element) => (
              <StageElement key={element.id} element={element} theme={theme} />
            ))}
            <ArrowLayer arrows={arrows} theme={theme} />
          </div>
        </div>
      </div>

      <figcaption className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${compact ? "mt-2.5" : "mt-4"}`}>
        <button
          type="button"
          data-stepper="previous"
          disabled={step === 0}
          onClick={() => go(step - 1)}
          aria-label="Previous step"
          className="grid size-10 shrink-0 place-items-center rounded-full ring-1 ring-ink/15 transition enabled:hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-35"
        >
          <svg viewBox="0 0 20 20" aria-hidden className="size-4 rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 10h11M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div aria-hidden="true" className="flex h-1.5 gap-1">
            {scene.steps.map((_, i) => (
              <span
                key={i}
                className={`h-full flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                  i < step ? "bg-highlighter-deep" : "bg-ink/10"
                }`}
              />
            ))}
          </div>
          <p className={`min-w-0 text-graphite ${compact ? "text-[0.85em]" : "text-[0.95em]"} leading-snug`}>
            <span className="font-mono text-[0.8em] tabular-nums text-graphite/80">
              {String(step).padStart(2, "0")}/{String(total).padStart(2, "0")}
            </span>
            {note && <span className="ml-2.5 text-ink">{note}</span>}
            {!note && step === 0 && <span className="ml-2.5">Press Next or tap the stage to begin.</span>}
          </p>
        </div>
        <button
          type="button"
          data-stepper="next"
          disabled={step === total}
          onClick={() => go(step + 1)}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.9em] font-medium text-paper transition enabled:hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-35"
        >
          {step === total ? "Done" : step === 0 ? "Start" : "Next"}
          {step < total && (
            <svg viewBox="0 0 20 20" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 10h11M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {narrow && !compact && (
          <p className="basis-full text-[0.8em] text-graphite">Turn your phone sideways or go full screen for a bigger stage.</p>
        )}
      </figcaption>
    </figure>
  );
}
