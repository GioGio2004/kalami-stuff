import type { CheckRule, CodeFile } from "@/lib/checks";

/**
 * The code sandbox, shared by both apps. Source of truth: kalami-stuff
 * components/sandbox; `npm run sync:student` copies it into the student app.
 */

export type SandboxStep = {
  title: string;
  /** Markdown. */
  instructions: string;
  hint?: string;
  checks: CheckRule[];
};

export type SandboxAsset = { name: string; url: string; alt?: string };

export type SandboxTask = {
  files: CodeFile[];
  steps: SandboxStep[];
  assets: SandboxAsset[];
};

/** Counters from the sandbox itself. Never keystrokes. */
export type IntegrityEvent = "pasteBlocked" | "dropBlocked" | "largeInserts" | "copyBlocked";

/** A red-pen note on a line of a file. */
export type LineComment = { id: string; file: string; line: number; text: string; author?: string };

export type { CodeFile };
