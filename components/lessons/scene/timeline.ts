import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { SplitText } from "gsap/SplitText";
import {
  arrowGeometry,
  CAMERA_HOME,
  cameraAt,
  cameraFor,
  DEFAULT_EMPHASIS,
  DEFAULT_ENTER,
  DEFAULT_EXIT,
  elementBox,
  initiallyShown,
  type EnterEffect,
  type Scene,
  type SceneAction,
  type SceneElement,
} from "@/lib/scene";
import { formatNumber } from "./elements";

/**
 * Turns a scene into one GSAP timeline over the stage's DOM: every step's
 * actions become tweens in order, and a label marks where each step ends. The
 * player scrubs between labels (SceneView), so going back plays a step in
 * reverse. Nothing here reads the scene's text; it only finds parts of the
 * stage by the data attributes elements.tsx renders.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */

if (typeof window !== "undefined") {
  gsap.registerPlugin(SplitText, DrawSVGPlugin);
}

export type Box = { x: number; y: number; w: number; h: number };

export type SceneTimeline = {
  tl: gsap.core.Timeline;
  /** Where the timeline is after step `i` has played: `labels[0]` is before any step. */
  labels: (string | number)[];
};

/** The gap between actions of a step that give no `at`. */
const FOLLOW = 0.15;
const EASE_OUT = "power3.out";
const EASE_IN_OUT = "power3.inOut";

export function buildSceneTimeline(scene: Scene, root: HTMLElement, camera: HTMLElement): SceneTimeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: EASE_OUT, overwrite: "auto" } });
  const labels: (string | number)[] = [0];

  // --- What's on the stage ----------------------------------------------------------------
  const elements = new Map(scene.elements.map((element) => [element.id, element]));
  const nodes = new Map<string, Element>();
  const boxes = new Map<string, Box>();
  for (const element of scene.elements) {
    const node = root.querySelector(`[data-el="${element.id}"]`);
    if (!node) continue;
    nodes.set(element.id, node);
    const box = elementBox(element);
    if (box) boxes.set(element.id, box);
  }
  const arrows = scene.elements.filter((e): e is Extract<SceneElement, { kind: "arrow" }> => e.kind === "arrow");
  const drawn = new Map<string, gsap.core.Tween>();

  function layoutArrow(arrow: Extract<SceneElement, { kind: "arrow" }>) {
    const g = nodes.get(arrow.id);
    const from = boxes.get(arrow.from);
    const to = boxes.get(arrow.to);
    if (!g || !from || !to) return;
    const geometry = arrowGeometry(from, to, arrow.curve ?? 0);
    const line = g.querySelector<SVGPathElement>("[data-arrow-line]");
    const head = g.querySelector<SVGPathElement>("[data-arrow-head]");
    if (!line || !head) return;
    line.setAttribute("d", geometry.d);
    // A finished draw-in left a dash the length of the old path; the new one must show whole.
    const draw = drawn.get(arrow.id);
    if (draw && draw.progress() === 1) gsap.set(line, { strokeDasharray: "none", strokeDashoffset: 0 });
    gsap.set(head, { x: geometry.end.x, y: geometry.end.y, rotation: geometry.angle, transformOrigin: "100% 50%" });
    const text = g.querySelector<SVGTextElement>("[data-arrow-label-text]");
    const bg = g.querySelector<SVGRectElement>("[data-arrow-label-bg]");
    if (text && bg) {
      text.setAttribute("x", String(geometry.mid.x));
      text.setAttribute("y", String(geometry.mid.y));
      try {
        const bounds = text.getBBox();
        bg.setAttribute("x", String(bounds.x - 12));
        bg.setAttribute("y", String(bounds.y - 6));
        bg.setAttribute("width", String(bounds.width + 24));
        bg.setAttribute("height", String(bounds.height + 12));
      } catch {
        // Not laid out yet (a hidden slide); the next layout gets it.
      }
    }
  }
  const attached = (id: string) => arrows.filter((arrow) => arrow.from === id || arrow.to === id);
  for (const arrow of arrows) layoutArrow(arrow);

  // --- The start: entered elements wait hidden, the camera is home ---------------------------
  const shown = initiallyShown(scene);
  for (const [id, node] of nodes) {
    if (!shown.has(id)) gsap.set(node, { autoAlpha: 0 });
  }
  gsap.set(camera, { ...CAMERA_HOME, transformOrigin: "0 0" });

  const parts = (node: Element) => Array.from(node.querySelectorAll("[data-part]"));
  const dimLayer = (node: Element) => node.querySelector("[data-dim]") ?? node;

  // --- Steps ---------------------------------------------------------------------------------
  scene.steps.forEach((step, i) => {
    const stepStart = tl.duration();
    let previous = stepStart;
    step.actions.forEach((action, j) => {
      const at = action.at !== undefined ? stepStart + action.at : j === 0 ? stepStart : previous + FOLLOW;
      previous = at;
      addAction(action, at);
    });
    // The step ends when its last tween does; the label is where "after step i" lives.
    const label = `end${i}`;
    tl.addLabel(label, tl.duration());
    labels.push(label);
  });

  function addAction(action: SceneAction, at: number) {
    switch (action.do) {
      case "enter":
        action.targets.forEach((id, n) => {
          const element = elements.get(id);
          const node = nodes.get(id);
          if (!element || !node) return;
          enter(element, node, action.effect ?? DEFAULT_ENTER[element.kind], at + n * (action.stagger ?? 0.12), action.duration, action.stagger);
        });
        break;
      case "exit":
        action.targets.forEach((id, n) => {
          const node = nodes.get(id);
          if (!node) return;
          const t = at + n * (action.stagger ?? 0.08);
          const d = action.duration ?? 0.45;
          switch (action.effect ?? DEFAULT_EXIT) {
            case "sink":
              tl.to(node, { autoAlpha: 0, y: 30, duration: d, ease: "power2.in" }, t);
              break;
            case "shrink":
              tl.to(node, { autoAlpha: 0, scale: 0.7, duration: d, ease: "power2.in" }, t);
              break;
            case "slide-left":
              tl.to(node, { autoAlpha: 0, x: -80, duration: d, ease: "power2.in" }, t);
              break;
            case "slide-right":
              tl.to(node, { autoAlpha: 0, x: 80, duration: d, ease: "power2.in" }, t);
              break;
            default:
              tl.to(node, { autoAlpha: 0, duration: d, ease: "power2.inOut" }, t);
          }
        });
        break;
      case "emphasize":
        action.targets.forEach((id, n) => {
          const node = nodes.get(id);
          if (!node) return;
          const t = at + n * 0.08;
          const d = action.duration;
          switch (action.effect ?? DEFAULT_EMPHASIS) {
            case "shake":
              tl.to(node, { keyframes: { x: [0, -9, 9, -6, 6, -3, 3, 0] }, duration: d ?? 0.55, ease: "none" }, t);
              break;
            case "glow":
              tl.fromTo(
                dimLayer(node),
                { "--glow": "0px" },
                { "--glow": "16px", duration: (d ?? 0.9) / 2, yoyo: true, repeat: 1, ease: "power2.inOut" },
                t,
              );
              break;
            case "flash": {
              const flash = node.querySelector("[data-flash]");
              if (flash) tl.to(flash, { keyframes: { opacity: [0, 0.5, 0] }, duration: d ?? 0.8, ease: "power1.inOut" }, t);
              break;
            }
            case "bounce":
              tl.to(node, { keyframes: { y: [0, -24, 0, -10, 0] }, duration: d ?? 0.75, ease: "power1.inOut" }, t);
              break;
            default:
              tl.to(node, { scale: 1.07, duration: (d ?? 0.5) / 2, yoyo: true, repeat: 1, ease: "power2.inOut" }, t);
          }
        });
        break;
      case "focus": {
        const keep = new Set(action.targets);
        const d = action.duration ?? 0.5;
        for (const [id, node] of nodes) {
          tl.to(dimLayer(node), { opacity: keep.size === 0 || keep.has(id) ? 1 : 0.22, duration: d, ease: "power2.inOut" }, at);
        }
        break;
      }
      case "move": {
        const node = nodes.get(action.target);
        const box = boxes.get(action.target);
        if (!node || !box) return;
        const followers = attached(action.target);
        tl.to(
          box,
          {
            x: action.x ?? box.x,
            y: action.y ?? box.y,
            w: action.w ?? box.w,
            h: action.h ?? box.h,
            duration: action.duration ?? 0.8,
            ease: EASE_IN_OUT,
            onUpdate() {
              gsap.set(node, { left: box.x, top: box.y, width: box.w, height: box.h });
              for (const arrow of followers) layoutArrow(arrow);
            },
          },
          at,
        );
        break;
      }
      case "camera": {
        const d = action.duration ?? 0.9;
        let to: { x: number; y: number; scale: number } = CAMERA_HOME;
        if (action.target !== undefined) {
          const box = boxes.get(action.target);
          if (box) to = cameraFor(box, action.scale);
        } else if (action.x !== undefined || action.y !== undefined || action.scale !== undefined) {
          to = cameraAt(action.x ?? 600, action.y ?? 337.5, action.scale ?? 2);
        }
        tl.to(camera, { ...to, duration: d, ease: EASE_IN_OUT }, at);
        break;
      }
    }
  }

  function enter(element: SceneElement, node: Element, effect: EnterEffect, at: number, duration?: number, stagger?: number) {
    const visible = { autoAlpha: 1, x: 0, y: 0, scale: 1 };
    const d = duration ?? 0.7;
    // Effects that belong to one kind fall back to something close for the rest.
    let use = effect;
    if (effect === "draw" && element.kind !== "arrow") use = "wipe";
    if (effect === "count" && element.kind !== "number") use = "fade";
    if (effect === "type" && element.kind !== "code") use = "cascade";
    if (use === "cascade" && (element.kind === "image" || element.kind === "shape" || element.kind === "note" || element.kind === "number" || element.kind === "arrow")) use = "pop";
    if ((use === "pop" || use === "rise" || use === "drop" || use === "slide-left" || use === "slide-right" || use === "wipe") && element.kind === "arrow") use = "fade";

    switch (use) {
      case "rise":
        tl.fromTo(node, { autoAlpha: 0, y: 44 }, { ...visible, duration: d, immediateRender: false }, at);
        break;
      case "drop":
        tl.fromTo(node, { autoAlpha: 0, y: -44 }, { ...visible, duration: d, immediateRender: false }, at);
        break;
      case "slide-left":
        tl.fromTo(node, { autoAlpha: 0, x: 90 }, { ...visible, duration: d, immediateRender: false }, at);
        break;
      case "slide-right":
        tl.fromTo(node, { autoAlpha: 0, x: -90 }, { ...visible, duration: d, immediateRender: false }, at);
        break;
      case "pop":
        tl.fromTo(node, { autoAlpha: 0, scale: 0.6 }, { ...visible, duration: d, ease: "back.out(1.7)", immediateRender: false }, at);
        break;
      case "wipe":
        tl.fromTo(
          node,
          { autoAlpha: 1, clipPath: "inset(0 100% 0 0)" },
          { ...visible, clipPath: "inset(0 0% 0 0)", duration: duration ?? 0.8, ease: EASE_IN_OUT, immediateRender: false },
          at,
        );
        break;
      case "cascade": {
        tl.set(node, visible, at);
        if (element.kind === "heading" || element.kind === "shape") {
          const text = node.querySelector<HTMLElement>("[data-text]");
          if (!text) break;
          const split = SplitText.create(text, { type: "words,chars", aria: "auto" });
          gsap.set(text, { perspective: 600 });
          tl.fromTo(
            split.chars,
            { opacity: 0, y: "0.55em", rotateX: -70 },
            { opacity: 1, y: 0, rotateX: 0, duration: duration ?? 0.65, stagger: stagger ?? 0.022, ease: EASE_OUT, immediateRender: false },
            at,
          );
        } else {
          const pieces = parts(node);
          if (pieces.length === 0) {
            tl.fromTo(node, { autoAlpha: 0, y: 44 }, { ...visible, duration: d, immediateRender: false }, at);
            break;
          }
          tl.fromTo(
            pieces,
            { autoAlpha: 0, x: -28 },
            { autoAlpha: 1, x: 0, duration: duration ?? 0.5, stagger: stagger ?? 0.14, ease: EASE_OUT, immediateRender: false },
            at,
          );
        }
        break;
      }
      case "type": {
        tl.fromTo(node, { autoAlpha: 0, y: 24 }, { ...visible, duration: 0.4, immediateRender: false }, at);
        const lines = parts(node);
        tl.fromTo(
          lines,
          { clipPath: "inset(0 100% 0 0)" },
          { clipPath: "inset(0 0% 0 0)", duration: duration ?? 0.32, stagger: stagger ?? 0.11, ease: "none", immediateRender: false },
          at + 0.2,
        );
        break;
      }
      case "draw": {
        const line = node.querySelector("[data-arrow-line]");
        const head = node.querySelector("[data-arrow-head]");
        if (!line || !head) break;
        tl.set(node, { autoAlpha: 1 }, at);
        const draw = gsap.fromTo(line, { drawSVG: "0%" }, { drawSVG: "100%", duration: duration ?? 0.8, ease: "power2.inOut", immediateRender: false });
        tl.add(draw, at);
        drawn.set(element.id, draw);
        tl.fromTo(head, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)", immediateRender: false }, at + (duration ?? 0.8) * 0.75);
        const label = node.querySelector("[data-arrow-label]");
        if (label) tl.fromTo(label, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, immediateRender: false }, at + (duration ?? 0.8) * 0.5);
        break;
      }
      case "count": {
        tl.fromTo(node, { autoAlpha: 0, y: 20 }, { ...visible, duration: 0.45, immediateRender: false }, at);
        const counter = node.querySelector<HTMLElement>("[data-count]");
        if (!counter) break;
        const value = Number(counter.dataset.value ?? 0);
        const decimals = Number(counter.dataset.decimals ?? 0);
        const state = { v: 0 };
        tl.to(
          state,
          {
            v: value,
            duration: duration ?? 1.4,
            ease: "power2.out",
            onUpdate() {
              counter.textContent = formatNumber(state.v, decimals);
            },
          },
          at,
        );
        break;
      }
      default:
        tl.fromTo(node, { autoAlpha: 0 }, { ...visible, duration: d, ease: "power2.inOut", immediateRender: false }, at);
    }
  }

  return { tl, labels };
}
