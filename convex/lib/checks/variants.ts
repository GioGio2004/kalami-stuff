import type { CheckRule, CodeFile } from "./types";

/**
 * Per-student variants. A task declares variables (`color`: three colours,
 * `city`: five cities…); every student gets one value of each, picked from
 * their own id, so a friend's code doesn't pass your checks. `{{color}}`
 * works in the instructions, the starter and solution files and the checks.
 * `{{student.firstName}}` and `{{student.lastName}}` are the student's name.
 */

export type Variable = { name: string; values: string[] };
export type VariantValues = Record<string, string>;

/** The name a lecturer sees while testing; real students get their own. */
export const SAMPLE_STUDENT = { firstName: "Nino", lastName: "Beridze" };

/** FNV-1a: small, stable, the same in the browser and on the server. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function withStudent(values: VariantValues, student: { firstName?: string; lastName?: string }): VariantValues {
  return {
    ...values,
    "student.firstName": student.firstName ?? "",
    "student.lastName": student.lastName ?? "",
  };
}

/** One student's values: the same every time for the same `seed` (user + assessment). */
export function pickValues(
  variables: Variable[],
  seed: string,
  student: { firstName?: string; lastName?: string },
): VariantValues {
  const values: VariantValues = {};
  for (const variable of variables) {
    if (variable.values.length > 0) {
      values[variable.name] = variable.values[hash(`${seed}:${variable.name}`) % variable.values.length];
    }
  }
  return withStudent(values, student);
}

/** Combination `index` for testing a task: every variable takes its value at `index` (wrapping). */
export function sampleValues(variables: Variable[], index: number, student = SAMPLE_STUDENT): VariantValues {
  const values: VariantValues = {};
  for (const variable of variables) {
    if (variable.values.length > 0) {
      values[variable.name] = variable.values[index % variable.values.length];
    }
  }
  return withStudent(values, student);
}

/** How many combinations cover every value of every variable at least once. */
export function sampleCount(variables: Variable[]): number {
  return Math.max(1, ...variables.map((v) => v.values.length));
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export function fill(text: string, values: VariantValues): string {
  return text.replace(PLACEHOLDER, (match, key: string) => (key in values ? values[key] : match));
}

/** Placeholders a text uses that aren't variables of the task. */
export function unknownPlaceholders(text: string, names: Set<string>): string[] {
  const unknown: string[] = [];
  for (const [, key] of text.matchAll(PLACEHOLDER)) {
    if (!names.has(key) && key !== "student.firstName" && key !== "student.lastName") unknown.push(key);
  }
  return unknown;
}

export function fillFiles(files: CodeFile[], values: VariantValues): CodeFile[] {
  return files.map((file) => ({ name: file.name, content: fill(file.content, values) }));
}

export function fillRule<R extends CheckRule>(rule: R, values: VariantValues): R {
  const out: Record<string, unknown> = { ...rule };
  for (const [key, value] of Object.entries(rule)) {
    if (key === "id" || key === "type") continue;
    if (typeof value === "string") out[key] = fill(value, values);
    else if (Array.isArray(value)) out[key] = value.map((v) => (typeof v === "string" ? fill(v, values) : v));
  }
  return out as R;
}

type TaskShape = {
  files: CodeFile[];
  steps: { title: string; instructions: string; hint?: string; checks: CheckRule[] }[];
};

/** A task as one student sees it: every placeholder replaced with their values. */
export function fillTask<T extends TaskShape>(task: T, values: VariantValues): T {
  return {
    ...task,
    files: fillFiles(task.files, values),
    steps: task.steps.map((step) => ({
      ...step,
      title: fill(step.title, values),
      instructions: fill(step.instructions, values),
      hint: step.hint === undefined ? undefined : fill(step.hint, values),
      checks: step.checks.map((rule) => fillRule(rule, values)),
    })),
  };
}
