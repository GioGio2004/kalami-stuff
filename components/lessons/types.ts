import type { Scene } from "@/lib/scene";

// A lesson block as both apps receive it from the backend (convex/lib/validators.ts
// lessonBlockValidator). Written out here, not imported, because this folder is
// copied into the student app (scripts/sync-student.mjs), which has its own API types.

export type CalloutTone = "tip" | "definition" | "warning" | "note";

export type LessonCheck = {
  kind: "single" | "multiple" | "short";
  prompt: string;
  options?: { text: string; correct: boolean }[];
  accepted?: string[];
  explanation?: string;
};

export type LessonBlock =
  | { id: string; type: "text"; md: string }
  | { id: string; type: "callout"; tone: CalloutTone; title?: string; md: string }
  | { id: string; type: "code"; language: string; code: string; caption?: string; preview?: boolean }
  | { id: string; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; type: "video"; url: string; caption?: string }
  | { id: string; type: "steps"; title?: string; steps: { title?: string; md: string }[] }
  | { id: string; type: "check"; check: LessonCheck }
  | { id: string; type: "scene"; scene: Scene };

export type LessonBlockType = LessonBlock["type"];

/** YouTube and Vimeo play inside the lesson (same rule as convex/model/lessons.ts videoEmbedUrl). */
export function videoEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = parsed.pathname.slice(1);
    else if (host === "youtube.com" && parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (host === "youtube.com" && /^\/(embed|shorts)\//.test(parsed.pathname)) id = parsed.pathname.split("/")[2];
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com" && /^\/\d+$/.test(parsed.pathname)) return `https://player.vimeo.com/video${parsed.pathname}`;
    if (host === "player.vimeo.com" && /^\/video\/\d+$/.test(parsed.pathname)) return parsed.href;
  } catch {
    // Not a URL.
  }
  return null;
}
