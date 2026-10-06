// The animated scene a lesson block can hold: its vocabulary, limits and rules,
// free of React and the DOM so the backend checks a scene with the same code the
// player and the editor use. The backend (convex/model/lessons.ts) refuses a
// block with any problem listed here; the editor shows the same problems while
// a lecturer edits; the player trusts what it gets.
//
// A scene is a fixed stage (SCENE_STAGE units, scaled to fit) with typed
// elements placed on it, and ordered steps a student clicks through. Each step
// applies named animations to elements by id. Nothing in a scene is code.
//
// The student app keeps a copy of this folder (scripts/sync-student.mjs); edit it here.

export const SCENE_STAGE = { width: 1200, height: 675 } as const;

export const SCENE_LIMITS = {
  elements: 24,
  steps: 30,
  actionsPerStep: 12,
  targetsPerAction: 24,
  listItems: 12,
  codeLines: 24,
  text: 600,
  md: 1_500,
  code: 2_000,
  title: 120,
  note: 300,
  label: 80,
  id: 32,
} as const;

export const SCENE_THEMES = ["paper", "ink"] as const;
export type SceneTheme = (typeof SCENE_THEMES)[number];

export const SCENE_COLORS = [
  "ink",
  "paper",
  "graphite",
  "panel",
  "card",
  "charcoal",
  "highlighter",
  "highlighter-deep",
  "red-pen",
  "ok",
  "warn",
] as const;
export type SceneColor = (typeof SCENE_COLORS)[number];

export const SCENE_SIZES = ["sm", "md", "lg", "xl"] as const;
export type SceneSize = (typeof SCENE_SIZES)[number];

export const SCENE_ALIGNS = ["left", "center", "right"] as const;
export type SceneAlign = (typeof SCENE_ALIGNS)[number];

export const SCENE_SHAPES = ["rect", "circle", "pill", "diamond"] as const;
export type SceneShape = (typeof SCENE_SHAPES)[number];

export const SCENE_TONES = ["tip", "definition", "warning", "note"] as const;
export type SceneTone = (typeof SCENE_TONES)[number];

export const SCENE_CODE_LANGUAGES = [
  "html",
  "css",
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "sql",
  "json",
  "bash",
  "text",
] as const;

/** Where an element sits, in stage units from the top-left corner. Width and height have defaults per kind. */
export type SceneBox = { x: number; y: number; w?: number; h?: number };

export type SceneElement =
  | ({ id: string; kind: "heading"; text: string; size?: SceneSize; align?: SceneAlign; color?: SceneColor } & SceneBox)
  | ({ id: string; kind: "text"; md: string; size?: SceneSize; align?: SceneAlign; color?: SceneColor } & SceneBox)
  | ({ id: string; kind: "list"; items: string[]; ordered?: boolean; size?: SceneSize; color?: SceneColor } & SceneBox)
  | ({ id: string; kind: "code"; language: string; code: string; size?: SceneSize } & SceneBox)
  | ({ id: string; kind: "image"; url: string; alt: string; fit?: "cover" | "contain" } & SceneBox)
  | ({
      id: string;
      kind: "shape";
      shape: SceneShape;
      fill?: SceneColor;
      stroke?: SceneColor;
      label?: string;
      color?: SceneColor;
    } & SceneBox)
  | { id: string; kind: "arrow"; from: string; to: string; label?: string; color?: SceneColor; curve?: number }
  | ({
      id: string;
      kind: "number";
      value: number;
      label?: string;
      prefix?: string;
      suffix?: string;
      decimals?: number;
      size?: SceneSize;
      color?: SceneColor;
    } & SceneBox)
  | ({ id: string; kind: "note"; tone: SceneTone; md: string } & SceneBox);

export type SceneElementKind = SceneElement["kind"];
export const SCENE_ELEMENT_KINDS = ["heading", "text", "list", "code", "image", "shape", "arrow", "number", "note"] as const;

export const ENTER_EFFECTS = [
  "fade",
  "rise",
  "drop",
  "slide-left",
  "slide-right",
  "pop",
  "cascade",
  "wipe",
  "draw",
  "count",
  "type",
] as const;
export type EnterEffect = (typeof ENTER_EFFECTS)[number];

export const EXIT_EFFECTS = ["fade", "sink", "shrink", "slide-left", "slide-right"] as const;
export type ExitEffect = (typeof EXIT_EFFECTS)[number];

export const EMPHASIS_EFFECTS = ["pulse", "shake", "glow", "flash", "bounce"] as const;
export type EmphasisEffect = (typeof EMPHASIS_EFFECTS)[number];

/** Timing every action may carry: when it starts within its step (seconds), and how long it takes. */
export type SceneTiming = { at?: number; duration?: number };

export type SceneAction =
  | ({ do: "enter"; targets: string[]; effect?: EnterEffect; stagger?: number } & SceneTiming)
  | ({ do: "exit"; targets: string[]; effect?: ExitEffect; stagger?: number } & SceneTiming)
  | ({ do: "emphasize"; targets: string[]; effect?: EmphasisEffect } & SceneTiming)
  /** Dims everything but the targets; no targets lifts the focus. */
  | ({ do: "focus"; targets: string[] } & SceneTiming)
  | ({ do: "move"; target: string; x?: number; y?: number; w?: number; h?: number } & SceneTiming)
  /** Frames an element, or a point (x, y at the centre) at a zoom; nothing resets the camera. */
  | ({ do: "camera"; target?: string; x?: number; y?: number; scale?: number } & SceneTiming);

export type SceneActionKind = SceneAction["do"];

export type SceneStep = { note?: string; actions: SceneAction[] };

/** The scene part of a `scene` lesson block. */
export type Scene = {
  title?: string;
  theme?: SceneTheme;
  elements: SceneElement[];
  steps: SceneStep[];
};

/** The size an element takes when the scene leaves it out. */
export const DEFAULT_SIZE: Record<Exclude<SceneElementKind, "arrow">, { w: number; h: number }> = {
  heading: { w: 720, h: 120 },
  text: { w: 520, h: 160 },
  list: { w: 520, h: 240 },
  code: { w: 560, h: 280 },
  image: { w: 480, h: 320 },
  shape: { w: 200, h: 120 },
  number: { w: 320, h: 160 },
  note: { w: 420, h: 120 },
};

/** The entrance an element gets when the step names none. */
export const DEFAULT_ENTER: Record<SceneElementKind, EnterEffect> = {
  heading: "cascade",
  text: "rise",
  list: "cascade",
  code: "type",
  image: "pop",
  shape: "pop",
  arrow: "draw",
  number: "count",
  note: "pop",
};

export const DEFAULT_EXIT: ExitEffect = "fade";
export const DEFAULT_EMPHASIS: EmphasisEffect = "pulse";

export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** The element's box with its defaults filled in; arrows have none. */
export function elementBox(element: SceneElement): { x: number; y: number; w: number; h: number } | null {
  if (element.kind === "arrow") return null;
  const size = DEFAULT_SIZE[element.kind];
  return { x: element.x, y: element.y, w: element.w ?? size.w, h: element.h ?? size.h };
}

/**
 * Elements that are on the stage before the first step: everything no step
 * brings in. An element some step enters stays hidden until that step.
 */
export function initiallyShown(scene: Scene): Set<string> {
  const entered = new Set<string>();
  for (const step of scene.steps) {
    for (const action of step.actions) {
      if (action.do === "enter") for (const id of action.targets) entered.add(id);
    }
  }
  return new Set(scene.elements.filter((e) => !entered.has(e.id)).map((e) => e.id));
}

// --- Rules --------------------------------------------------------------------------------

const isFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * What keeps a scene from being accepted, in a lecturer's (or an agent's)
 * words, every problem at once. Empty means the scene is fine. Shapes are
 * assumed to match the type (the backend's validators guarantee that); these
 * are the rules a type can't say.
 */
export function sceneProblems(scene: Scene): string[] {
  const out: string[] = [];
  const { width, height } = SCENE_STAGE;
  const L = SCENE_LIMITS;

  if (scene.title !== undefined && scene.title.length > L.title) out.push(`title: at most ${L.title} characters.`);
  if (scene.elements.length === 0) out.push("elements: add at least one element.");
  if (scene.elements.length > L.elements) out.push(`elements: at most ${L.elements} elements per scene.`);
  if (scene.steps.length === 0) out.push("steps: add at least one step.");
  if (scene.steps.length > L.steps) out.push(`steps: at most ${L.steps} steps per scene.`);

  const ids = new Map<string, SceneElement>();
  scene.elements.forEach((element, i) => {
    const where = `elements[${i}]`;
    if (!ID_PATTERN.test(element.id)) {
      out.push(`${where}.id: use 1 to ${L.id} lowercase letters, digits, - or _, starting with a letter (got "${element.id}").`);
    } else if (ids.has(element.id)) {
      out.push(`${where}.id: "${element.id}" is used twice; ids must be unique.`);
    }
    ids.set(element.id, element);

    if (element.kind !== "arrow") {
      if (!isFinite(element.x) || element.x < 0 || element.x > width) out.push(`${where}.x: 0 to ${width}.`);
      if (!isFinite(element.y) || element.y < 0 || element.y > height) out.push(`${where}.y: 0 to ${height}.`);
      if (element.w !== undefined && (!isFinite(element.w) || element.w < 16 || element.w > width)) out.push(`${where}.w: 16 to ${width}.`);
      if (element.h !== undefined && (!isFinite(element.h) || element.h < 16 || element.h > height)) out.push(`${where}.h: 16 to ${height}.`);
      const box = elementBox(element);
      if (box && isFinite(box.x) && isFinite(box.w) && box.x + box.w > width + 1) out.push(`${where}: x + w goes past the stage's width (${width}).`);
      if (box && isFinite(box.y) && isFinite(box.h) && box.y + box.h > height + 1) out.push(`${where}: y + h goes past the stage's height (${height}).`);
    }

    switch (element.kind) {
      case "heading":
        if (element.text.trim() === "" || element.text.length > L.text) out.push(`${where}.text: 1 to ${L.text} characters.`);
        break;
      case "text":
        if (element.md.trim() === "" || element.md.length > L.md) out.push(`${where}.md: 1 to ${L.md} characters.`);
        break;
      case "list":
        if (element.items.length === 0 || element.items.length > L.listItems) out.push(`${where}.items: 1 to ${L.listItems} items.`);
        if (element.items.some((item) => item.trim() === "" || item.length > L.text)) out.push(`${where}.items: each 1 to ${L.text} characters.`);
        break;
      case "code":
        if (!(SCENE_CODE_LANGUAGES as readonly string[]).includes(element.language)) {
          out.push(`${where}.language: one of ${SCENE_CODE_LANGUAGES.join(", ")}.`);
        }
        if (element.code.trim() === "" || element.code.length > L.code) out.push(`${where}.code: 1 to ${L.code} characters.`);
        if (element.code.split("\n").length > L.codeLines) out.push(`${where}.code: at most ${L.codeLines} lines; a scene shows a fragment, not a file.`);
        break;
      case "image":
        if (!isHttps(element.url)) out.push(`${where}.url: an https:// link.`);
        if (element.alt.trim() === "" || element.alt.length > L.text) out.push(`${where}.alt: describe the image, 1 to ${L.text} characters.`);
        break;
      case "shape":
        if (element.label !== undefined && element.label.length > L.label) out.push(`${where}.label: at most ${L.label} characters.`);
        break;
      case "arrow": {
        if (element.from === element.to) out.push(`${where}: from and to must be different elements.`);
        if (element.label !== undefined && element.label.length > L.label) out.push(`${where}.label: at most ${L.label} characters.`);
        if (element.curve !== undefined && (!isFinite(element.curve) || element.curve < -1 || element.curve > 1)) out.push(`${where}.curve: -1 to 1.`);
        break;
      }
      case "number":
        if (!isFinite(element.value) || Math.abs(element.value) > 1e12) out.push(`${where}.value: a number.`);
        if (element.decimals !== undefined && (!Number.isInteger(element.decimals) || element.decimals < 0 || element.decimals > 4)) {
          out.push(`${where}.decimals: 0 to 4.`);
        }
        for (const key of ["label", "prefix", "suffix"] as const) {
          const value = element[key];
          if (value !== undefined && value.length > L.label) out.push(`${where}.${key}: at most ${L.label} characters.`);
        }
        break;
      case "note":
        if (element.md.trim() === "" || element.md.length > L.md) out.push(`${where}.md: 1 to ${L.md} characters.`);
        break;
    }
  });

  // Arrows need both ends on the stage, and the ends must have a box.
  scene.elements.forEach((element, i) => {
    if (element.kind !== "arrow") return;
    for (const end of ["from", "to"] as const) {
      const target = ids.get(element[end]);
      if (!target) out.push(`elements[${i}].${end}: no element with id "${element[end]}".`);
      else if (target.kind === "arrow") out.push(`elements[${i}].${end}: an arrow can't point at another arrow.`);
    }
  });

  scene.steps.forEach((step, s) => {
    const where = `steps[${s}]`;
    if (step.note !== undefined && step.note.length > L.note) out.push(`${where}.note: at most ${L.note} characters.`);
    if (step.actions.length === 0) out.push(`${where}.actions: a step needs at least one action.`);
    if (step.actions.length > L.actionsPerStep) out.push(`${where}.actions: at most ${L.actionsPerStep} actions per step.`);
    step.actions.forEach((action, a) => {
      const here = `${where}.actions[${a}]`;
      if (action.at !== undefined && (!isFinite(action.at) || action.at < 0 || action.at > 10)) out.push(`${here}.at: 0 to 10 seconds.`);
      if (action.duration !== undefined && (!isFinite(action.duration) || action.duration < 0.1 || action.duration > 6)) {
        out.push(`${here}.duration: 0.1 to 6 seconds.`);
      }
      if ("stagger" in action && action.stagger !== undefined && (!isFinite(action.stagger) || action.stagger < 0 || action.stagger > 1)) {
        out.push(`${here}.stagger: 0 to 1 seconds.`);
      }
      if ("targets" in action) {
        if (action.targets.length === 0 && action.do !== "focus") out.push(`${here}.targets: name at least one element.`);
        if (action.targets.length > L.targetsPerAction) out.push(`${here}.targets: at most ${L.targetsPerAction}.`);
        for (const id of action.targets) {
          if (!ids.has(id)) out.push(`${here}.targets: no element with id "${id}".`);
        }
      }
      if (action.do === "move") {
        const target = ids.get(action.target);
        if (!target) out.push(`${here}.target: no element with id "${action.target}".`);
        else if (target.kind === "arrow") out.push(`${here}.target: arrows follow their ends; move those instead.`);
        if (action.x === undefined && action.y === undefined && action.w === undefined && action.h === undefined) {
          out.push(`${here}: give x, y, w or h to move to.`);
        }
        if (action.x !== undefined && (!isFinite(action.x) || action.x < 0 || action.x > width)) out.push(`${here}.x: 0 to ${width}.`);
        if (action.y !== undefined && (!isFinite(action.y) || action.y < 0 || action.y > height)) out.push(`${here}.y: 0 to ${height}.`);
        if (action.w !== undefined && (!isFinite(action.w) || action.w < 16 || action.w > width)) out.push(`${here}.w: 16 to ${width}.`);
        if (action.h !== undefined && (!isFinite(action.h) || action.h < 16 || action.h > height)) out.push(`${here}.h: 16 to ${height}.`);
      }
      if (action.do === "camera") {
        if (action.target !== undefined) {
          const target = ids.get(action.target);
          if (!target) out.push(`${here}.target: no element with id "${action.target}".`);
          else if (target.kind === "arrow") out.push(`${here}.target: frame one of the arrow's ends instead.`);
        }
        if (action.x !== undefined && (!isFinite(action.x) || action.x < 0 || action.x > width)) out.push(`${here}.x: 0 to ${width}.`);
        if (action.y !== undefined && (!isFinite(action.y) || action.y < 0 || action.y > height)) out.push(`${here}.y: 0 to ${height}.`);
        if (action.scale !== undefined && (!isFinite(action.scale) || action.scale < 1 || action.scale > 4)) out.push(`${here}.scale: 1 to 4.`);
      }
    });
  });

  return out;
}

function isHttps(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The words a scene shows, for search. */
export function sceneText(scene: Scene): string {
  const parts: string[] = [scene.title ?? ""];
  for (const element of scene.elements) {
    switch (element.kind) {
      case "heading":
        parts.push(element.text);
        break;
      case "text":
      case "note":
        parts.push(element.md);
        break;
      case "list":
        parts.push(...element.items);
        break;
      case "code":
        parts.push(element.code);
        break;
      case "image":
        parts.push(element.alt);
        break;
      case "shape":
      case "arrow":
        if (element.label) parts.push(element.label);
        break;
      case "number":
        parts.push(`${element.prefix ?? ""}${element.value}${element.suffix ?? ""} ${element.label ?? ""}`);
        break;
    }
  }
  for (const step of scene.steps) if (step.note) parts.push(step.note);
  return parts.join(" ");
}

// --- Geometry the player needs (pure, so it's testable) ----------------------------------

export type Point = { x: number; y: number };

/**
 * Where an arrow leaves one box and reaches the other: the point on each box's
 * edge along the line between their centres, pulled in a little so the head
 * doesn't touch the box.
 */
export function arrowEnds(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
  gap = 10,
): { start: Point; end: Point } {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  return { start: edgePoint(from, a, b, gap), end: edgePoint(to, b, a, gap) };
}

function edgePoint(box: { x: number; y: number; w: number; h: number }, centre: Point, towards: Point, gap: number): Point {
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  if (dx === 0 && dy === 0) return centre;
  // How far along the centre line the box's edge is: the smaller of the two axis limits.
  const tx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  const length = Math.hypot(dx, dy);
  const extra = gap / length;
  return { x: centre.x + dx * (t + extra), y: centre.y + dy * (t + extra) };
}

/**
 * The arrow between two boxes as the SVG layer draws it: the path (bowed
 * sideways by `curve`, -1 to 1, as a share of its length), where its head sits
 * and points (degrees), and where a label goes.
 */
export function arrowGeometry(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
  curve = 0,
): { d: string; start: Point; end: Point; angle: number; mid: Point } {
  const { start, end } = arrowEnds(from, to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (curve === 0 || (dx === 0 && dy === 0)) {
    return {
      d: `M ${r(start.x)} ${r(start.y)} L ${r(end.x)} ${r(end.y)}`,
      start,
      end,
      angle: degrees(dx, dy),
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
  }
  // The control point sits off the midpoint, perpendicular to the line.
  const length = Math.hypot(dx, dy);
  const control = { x: (start.x + end.x) / 2 - (dy / length) * length * curve * 0.5, y: (start.y + end.y) / 2 + (dx / length) * length * curve * 0.5 };
  return {
    d: `M ${r(start.x)} ${r(start.y)} Q ${r(control.x)} ${r(control.y)} ${r(end.x)} ${r(end.y)}`,
    start,
    end,
    angle: degrees(end.x - control.x, end.y - control.y),
    // The curve's point halfway along.
    mid: { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y },
  };
}

function degrees(dx: number, dy: number): number {
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10;
}

// The || 0 turns a -0 into 0.
const r = (n: number) => Math.round(n * 10) / 10 || 0;

/**
 * The camera transform that frames a box in the stage: a zoom that fits it with
 * room around, centred, never past the stage's edges. `x`/`y` are the stage's
 * translation (in stage units, before its scale) and `scale` its zoom.
 */
export function cameraFor(
  box: { x: number; y: number; w: number; h: number },
  scale?: number,
  stage: { width: number; height: number } = SCENE_STAGE,
): { x: number; y: number; scale: number } {
  const padding = 1.5;
  const fit = Math.min(stage.width / (box.w * padding), stage.height / (box.h * padding));
  const zoom = clamp(scale ?? fit, 1, 4);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cameraAt(cx, cy, zoom, stage);
}

/** The camera centred on a stage point at a zoom, kept inside the stage. */
export function cameraAt(
  cx: number,
  cy: number,
  scale: number,
  stage: { width: number; height: number } = SCENE_STAGE,
): { x: number; y: number; scale: number } {
  const zoom = clamp(scale, 1, 4);
  const viewW = stage.width / zoom;
  const viewH = stage.height / zoom;
  const left = clamp(cx - viewW / 2, 0, stage.width - viewW);
  const top = clamp(cy - viewH / 2, 0, stage.height - viewH);
  return { x: r(-left * zoom), y: r(-top * zoom), scale: zoom };
}

export const CAMERA_HOME = { x: 0, y: 0, scale: 1 } as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
