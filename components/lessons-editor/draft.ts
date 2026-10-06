import { SCENE_TEMPLATES } from "@/components/lessons/scene/templates";
import type { CalloutTone, LessonBlock, LessonBlockType, LessonCheck } from "@/components/lessons/types";
import { sceneProblems } from "@/lib/scene";
import type { LessonBlockInput } from "@/components/studio/types";

/**
 * The lesson editor's working copy. Each block carries a `key` that stays put
 * while the lecturer edits (React keys, focus, selection); `block.id` is the
 * server's id, empty until the block has been saved once.
 */
export type DraftItem = { key: string; block: LessonBlock };

export const BLOCK_TYPES: { type: LessonBlockType; label: string; description: string }[] = [
  { type: "text", label: "Text", description: "Paragraphs, lists and headings, in Markdown." },
  { type: "callout", label: "Callout", description: "A tip, definition, warning or note in a box." },
  { type: "code", label: "Code", description: "An example, with a live preview for HTML and CSS." },
  { type: "image", label: "Image", description: "A picture from an https:// link, with a description." },
  { type: "video", label: "Video", description: "YouTube and Vimeo play inside the lesson." },
  { type: "steps", label: "Steps", description: "A procedure students reveal one step at a time." },
  { type: "check", label: "Quick check", description: "A question to answer on the spot. Not graded." },
  { type: "scene", label: "Animated scene", description: "Elements on a stage, animated step by step. Best built by your AI assistant." },
];

export const BLOCK_LABEL = Object.fromEntries(BLOCK_TYPES.map((t) => [t.type, t.label])) as Record<LessonBlockType, string>;

export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "php", label: "PHP" },
  { value: "sql", label: "SQL" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
  { value: "text", label: "Plain text" },
];

export const CALLOUT_TONES: { value: CalloutTone; label: string }[] = [
  { value: "tip", label: "Tip" },
  { value: "definition", label: "Definition" },
  { value: "warning", label: "Watch out" },
  { value: "note", label: "Note" },
];

/** Only HTML and CSS run in the preview (the same sandboxed frame as code tasks). */
export function canPreview(language: string): boolean {
  return language === "html" || language === "css";
}

let counter = 0;
/** A key for a block made in this editor; "~" never appears in a server id, so they can't collide. */
export function newKey(): string {
  counter += 1;
  return `new~${counter}`;
}

export function blankBlock(type: LessonBlockType): LessonBlock {
  switch (type) {
    case "text":
      return { id: "", type, md: "" };
    case "callout":
      return { id: "", type, tone: "tip", md: "" };
    case "code":
      return { id: "", type, language: "html", code: "", preview: true };
    case "image":
      return { id: "", type, url: "", alt: "" };
    case "video":
      return { id: "", type, url: "" };
    case "steps":
      return { id: "", type, steps: [{ md: "" }, { md: "" }] };
    case "check":
      return {
        id: "",
        type,
        check: {
          kind: "single",
          prompt: "",
          options: [
            { text: "", correct: true },
            { text: "", correct: false },
          ],
          accepted: [""],
        },
      };
    case "scene":
      return { id: "", type, scene: structuredClone(SCENE_TEMPLATES[0].scene) };
  }
}

export function fromServer(blocks: LessonBlock[]): DraftItem[] {
  return blocks.map((block) => ({ key: block.id, block }));
}

/**
 * The server's blocks, keeping the keys of blocks the editor already has (by
 * id), so forms don't remount when someone else's change comes in.
 */
export function adopt(blocks: LessonBlock[], current: DraftItem[]): DraftItem[] {
  const keyById = new Map(current.filter((item) => item.block.id !== "").map((item) => [item.block.id, item.key]));
  return blocks.map((block) => ({ key: keyById.get(block.id) ?? block.id, block }));
}

export function duplicateItem(item: DraftItem): DraftItem {
  return { key: newKey(), block: { ...structuredClone(item.block), id: "" } };
}

function optional(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** Drops keys whose value is undefined, so equal blocks always serialise the same way. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** What the server gets for a block: empty optional fields left out, fields of other kinds dropped, the id only once it has one. */
export function toInput(block: LessonBlock): LessonBlockInput {
  const id = block.id === "" ? undefined : block.id;
  switch (block.type) {
    case "text":
      return clean({ id, type: block.type, md: block.md });
    case "callout":
      return clean({ id, type: block.type, tone: block.tone, title: optional(block.title), md: block.md });
    case "code":
      return clean({
        id,
        type: block.type,
        language: block.language,
        code: block.code,
        caption: optional(block.caption),
        preview: block.preview && canPreview(block.language) ? true : undefined,
      });
    case "image":
      return clean({ id, type: block.type, url: block.url.trim(), alt: block.alt, caption: optional(block.caption) });
    case "video":
      return clean({ id, type: block.type, url: block.url.trim(), caption: optional(block.caption) });
    case "steps":
      return clean({
        id,
        type: block.type,
        title: optional(block.title),
        steps: block.steps.map((step) => clean({ title: optional(step.title), md: step.md })),
      });
    case "check": {
      const { check } = block;
      return clean({
        id,
        type: block.type,
        check: clean<LessonCheck>({
          kind: check.kind,
          prompt: check.prompt,
          options: check.kind === "short" ? undefined : (check.options ?? []),
          accepted: check.kind === "short" ? (check.accepted ?? []).filter((a) => a.trim() !== "") : undefined,
          explanation: optional(check.explanation),
        }),
      });
    }
    case "scene":
      return clean({ id, type: block.type, scene: block.scene });
  }
}

/** The lesson's content as one string, ids left out: equal strings mean nothing to save. */
export function contentKey(items: DraftItem[]): string {
  return JSON.stringify(items.map((item) => toInput({ ...item.block, id: "" })));
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** What still keeps a block from saving, in the lecturer's words (the server has the final say). */
export function blockProblems(block: LessonBlock): string[] {
  const out: string[] = [];
  const blank = (s: string | undefined) => s === undefined || s.trim() === "";
  switch (block.type) {
    case "text":
      if (blank(block.md)) out.push("Write some text.");
      break;
    case "callout":
      if (blank(block.md)) out.push("Write the callout's text.");
      break;
    case "code":
      if (blank(block.code)) out.push("Add some code.");
      break;
    case "image":
      if (!isHttpsUrl(block.url)) out.push("Add an image link that starts with https://");
      if (blank(block.alt)) out.push("Describe the image (alt text).");
      break;
    case "video":
      if (!isHttpsUrl(block.url)) out.push("Add a video link that starts with https://");
      break;
    case "steps":
      if (block.steps.length === 0) out.push("Add at least one step.");
      if (block.steps.some((step) => blank(step.md))) out.push("Every step needs its text.");
      break;
    case "check": {
      const { check } = block;
      if (blank(check.prompt)) out.push("Write the question.");
      if (check.kind === "short") {
        if (!(check.accepted ?? []).some((a) => !blank(a))) out.push("Add at least one accepted answer.");
      } else {
        const options = check.options ?? [];
        const correct = options.filter((o) => o.correct).length;
        if (options.length < 2) out.push("Give at least two options.");
        if (options.some((o) => blank(o.text))) out.push("Fill in every option, or remove the empty ones.");
        if (check.kind === "single" && correct !== 1) out.push("Mark exactly one option as right.");
        if (check.kind === "multiple" && correct < 1) out.push("Mark at least one option as right.");
      }
      break;
    }
    case "scene":
      out.push(...sceneProblems(block.scene));
      break;
  }
  return out;
}

/** Why a block can't be shown in the preview yet, if it can't (the renderer needs a real link for media). */
export function previewGap(block: LessonBlock): string | null {
  switch (block.type) {
    case "text":
      return block.md.trim() === "" ? "Empty text block" : null;
    case "callout":
      return block.md.trim() === "" && !block.title ? "Empty callout" : null;
    case "code":
      return block.code.trim() === "" ? "No code yet" : null;
    case "image":
      return isHttpsUrl(block.url) ? null : "Add an image link to see the image here";
    case "video":
      return isHttpsUrl(block.url) ? null : "Add a video link to see the video here";
    case "steps":
      return block.steps.every((step) => step.md.trim() === "") ? "No steps written yet" : null;
    case "check":
      return block.check.prompt.trim() === "" ? "Write the question to see the check" : null;
    case "scene":
      return block.scene.elements.length === 0 ? "Add elements to the scene to see it here" : null;
  }
}
