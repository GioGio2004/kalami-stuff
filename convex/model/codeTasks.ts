import { ConvexError, v } from "convex/values";
import {
  fill,
  fillFiles,
  fillRule,
  runChecks,
  sampleCount,
  sampleValues,
  selectorError,
  unknownPlaceholders,
  type CheckRule,
  type CodeFile,
  type Variable,
  type VariantValues,
} from "../lib/checks";
import { appError } from "../lib/errors";
import { optionalText, requireText } from "../lib/input";
import type { CheckRuleDoc, CheckRuleInput, CodeQuestionInput, CodeTask } from "../lib/validators";

/**
 * Code questions: HTML/CSS tasks split into small steps, freeCodeCamp-style.
 * Every task carries a solution, and nothing is saved unless the solution
 * passes every check, for every per-student variant — so a task an agent (or
 * a lecturer) writes is always one a student can finish.
 */

export const MAX_FILES = 5;
export const MAX_FILE_CHARS = 50_000;
const MAX_STEPS = 40;
const MAX_CHECKS_PER_STEP = 10;
const MAX_HIDDEN_CHECKS = 30;
const MAX_ASSETS = 20;
const MAX_VARIABLES = 10;
const MAX_VALUES = 20;

const FILE_NAME = /^[a-z0-9][a-z0-9_-]*\.(html|css)$/;
const ASSET_NAME = /^[a-z0-9][a-z0-9_-]*\.(png|jpe?g|gif|svg|webp|avif)$/;
const VARIABLE_NAME = /^[a-z][a-zA-Z0-9_]*$/;

/** Where task images must live (ImageKit). Narrow it to the Kalami account with CODE_ASSET_URL_PREFIX. */
export function assetUrlPrefix(): string {
  return process.env.CODE_ASSET_URL_PREFIX ?? "https://ik.imagekit.io/";
}

function checkFiles(files: CodeFile[], label: string): CodeFile[] {
  if (files.length === 0 || files.length > MAX_FILES) {
    throw appError("INVALID_INPUT", `${label}: give 1 to ${MAX_FILES} files.`);
  }
  const names = new Set<string>();
  for (const file of files) {
    if (!FILE_NAME.test(file.name)) {
      throw appError(
        "INVALID_INPUT",
        `${label}: "${file.name}" isn't allowed. Use lower-case names ending in .html or .css, like index.html or style.css.`,
      );
    }
    if (names.has(file.name)) {
      throw appError("INVALID_INPUT", `${label}: "${file.name}" appears twice.`);
    }
    if (file.content.length > MAX_FILE_CHARS) {
      throw appError("INVALID_INPUT", `${label}: "${file.name}" is longer than ${MAX_FILE_CHARS} characters.`);
    }
    names.add(file.name);
  }
  if (!names.has("index.html")) {
    throw appError("INVALID_INPUT", `${label}: index.html is required.`);
  }
  return files.map((file) => ({ name: file.name, content: file.content }));
}

function checkVariables(variables: Variable[]): Variable[] {
  if (variables.length > MAX_VARIABLES) {
    throw appError("INVALID_INPUT", `At most ${MAX_VARIABLES} variables.`);
  }
  const names = new Set<string>();
  return variables.map((variable) => {
    const name = variable.name.trim();
    if (!VARIABLE_NAME.test(name) || names.has(name) || name === "student") {
      throw appError(
        "INVALID_INPUT",
        `Variable "${variable.name}": use a unique name of letters and digits starting with a lower-case letter, like color or itemCount.`,
      );
    }
    names.add(name);
    const values = variable.values.map((value) => value.trim()).filter((value) => value !== "");
    if (values.length === 0 || values.length > MAX_VALUES) {
      throw appError("INVALID_INPUT", `Variable "${name}": give 1 to ${MAX_VALUES} values.`);
    }
    for (const value of values) {
      if (value.length > 200) {
        throw appError("INVALID_INPUT", `Variable "${name}": values must be at most 200 characters.`);
      }
    }
    return { name, values };
  });
}

/** Checks one rule's fields and gives it its id. `sample` fills placeholders for the selector check. */
function normalizeRule(rule: CheckRuleInput, id: string, where: string, sample: VariantValues): CheckRuleDoc {
  const label = requireText(rule.label, `${where} label`, 200);
  const at = `${where} (“${label}”)`;
  if (rule.type === "linked") {
    return { id, label, type: "linked", href: requireText(rule.href, `${at} href`, 200) };
  }
  const selector = requireText(rule.selector, `${at} selector`, 300);
  const error = selectorError(fill(selector, sample));
  if (error !== null) {
    throw appError("INVALID_INPUT", `${at}: the selector \`${selector}\` is not valid. ${error}`);
  }
  switch (rule.type) {
    case "exists":
    case "not_exists":
      return { id, label, type: rule.type, selector };
    case "count":
      if (rule.min === undefined && rule.max === undefined) {
        throw appError("INVALID_INPUT", `${at}: a count check needs min, max or both.`);
      }
      for (const n of [rule.min, rule.max]) {
        if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 1000)) {
          throw appError("INVALID_INPUT", `${at}: min and max must be whole numbers from 0 to 1000.`);
        }
      }
      return { id, label, type: "count", selector, min: rule.min, max: rule.max };
    case "text":
      if (rule.equals === undefined && rule.contains === undefined) {
        throw appError("INVALID_INPUT", `${at}: a text check needs equals or contains.`);
      }
      return {
        id,
        label,
        type: "text",
        selector,
        equals: rule.equals,
        contains: rule.contains,
        caseSensitive: rule.caseSensitive,
        every: rule.every,
      };
    case "attr":
      if (!/^[a-z][a-z0-9:_-]*$/i.test(rule.attribute)) {
        throw appError("INVALID_INPUT", `${at}: "${rule.attribute}" is not an attribute name.`);
      }
      return {
        id,
        label,
        type: "attr",
        selector,
        attribute: rule.attribute.toLowerCase(),
        equals: rule.equals,
        contains: rule.contains,
        every: rule.every,
      };
    case "css": {
      const property = rule.property.trim().toLowerCase();
      if (!/^-?[a-z][a-z0-9-]*$/.test(property)) {
        throw appError("INVALID_INPUT", `${at}: "${rule.property}" is not a CSS property.`);
      }
      if (rule.equals === undefined && (rule.oneOf === undefined || rule.oneOf.length === 0)) {
        throw appError("INVALID_INPUT", `${at}: a css check needs equals or oneOf.`);
      }
      if (rule.viewport !== undefined && (!Number.isInteger(rule.viewport) || rule.viewport < 200 || rule.viewport > 3000)) {
        throw appError("INVALID_INPUT", `${at}: viewport must be a width in px from 200 to 3000.`);
      }
      return {
        id,
        label,
        type: "css",
        selector,
        property,
        equals: rule.equals,
        oneOf: rule.oneOf,
        every: rule.every,
        viewport: rule.viewport,
      };
    }
  }
}

export type NormalizedCodeTask = {
  code: CodeTask;
  hiddenChecks: CheckRuleDoc[];
  solution: CodeFile[];
};

function stringsOf(rule: CheckRuleDoc): string[] {
  return Object.values(rule).flatMap((value) =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((x) => typeof x === "string") : [],
  );
}

/** Checks the shape of a code question and numbers its checks. Doesn't run them. */
export function normalizeCodeTaskShape(input: CodeQuestionInput): NormalizedCodeTask {
  const files = checkFiles(input.starterFiles, "Starter files");
  const solution = checkFiles(input.solution, "Solution");
  const starterNames = new Set(files.map((f) => f.name));
  for (const file of solution) {
    if (!starterNames.has(file.name)) {
      throw appError(
        "INVALID_INPUT",
        `Solution: "${file.name}" isn't a starter file. Students can only edit the starter files, so add it there (it may be empty).`,
      );
    }
  }
  const variables = checkVariables(input.variables ?? []);
  const sample = sampleValues(variables, 0);
  if (input.steps.length === 0 || input.steps.length > MAX_STEPS) {
    throw appError("INVALID_INPUT", `A code task needs 1 to ${MAX_STEPS} steps.`);
  }
  const steps = input.steps.map((step, s) => {
    const where = `Step ${s + 1}`;
    if (step.checks.length === 0 || step.checks.length > MAX_CHECKS_PER_STEP) {
      throw appError("INVALID_INPUT", `${where}: give 1 to ${MAX_CHECKS_PER_STEP} checks.`);
    }
    return {
      title: requireText(step.title, `${where} title`, 120),
      instructions: requireText(step.instructions, `${where} instructions`, 4000),
      hint: optionalText(step.hint, `${where} hint`, 1000),
      checks: step.checks.map((rule, c) =>
        normalizeRule(rule, `s${s + 1}c${c + 1}`, `${where}, check ${c + 1}`, sample),
      ),
    };
  });
  const hidden = input.hiddenChecks ?? [];
  if (hidden.length > MAX_HIDDEN_CHECKS) {
    throw appError("INVALID_INPUT", `At most ${MAX_HIDDEN_CHECKS} hidden checks.`);
  }
  const hiddenChecks = hidden.map((rule, h) => normalizeRule(rule, `h${h + 1}`, `Hidden check ${h + 1}`, sample));
  const assets = input.assets ?? [];
  if (assets.length > MAX_ASSETS) {
    throw appError("INVALID_INPUT", `At most ${MAX_ASSETS} images.`);
  }
  const prefix = assetUrlPrefix();
  const assetNames = new Set<string>();
  for (const asset of assets) {
    if (!ASSET_NAME.test(asset.name) || assetNames.has(asset.name)) {
      throw appError(
        "INVALID_INPUT",
        `Image "${asset.name}": use a unique lower-case file name like cat.jpg (png, jpg, gif, svg, webp or avif).`,
      );
    }
    if (!asset.url.startsWith(prefix) || asset.url.length > 500) {
      throw appError("INVALID_INPUT", `Image "${asset.name}": the URL must start with ${prefix}.`);
    }
    assetNames.add(asset.name);
  }

  // Every {{placeholder}} must be a variable (or the student's name).
  const names = new Set(variables.map((v) => v.name));
  const texts = [
    input.prompt,
    ...steps.flatMap((step) => [step.title, step.instructions, step.hint ?? "", ...step.checks.flatMap(stringsOf)]),
    ...hiddenChecks.flatMap(stringsOf),
    ...files.map((f) => f.content),
    ...solution.map((f) => f.content),
  ];
  const unknown = [...new Set(texts.flatMap((text) => unknownPlaceholders(text, names)))];
  if (unknown.length > 0) {
    throw appError(
      "INVALID_INPUT",
      `Unknown placeholder${unknown.length === 1 ? "" : "s"} ${unknown.map((u) => `{{${u}}}`).join(", ")}. Add ${unknown.length === 1 ? "it" : "them"} as a variable, or use {{student.firstName}} / {{student.lastName}}.`,
    );
  }

  return {
    code: {
      files,
      steps,
      assets: assets.map((a) => ({ name: a.name, url: a.url, alt: optionalText(a.alt, "Image alt text", 200) })),
      variables: variables.length > 0 ? variables : undefined,
    },
    hiddenChecks,
    solution,
  };
}

/** The solution with any starter file it leaves out, as a student would have it. */
export function solutionFiles(task: NormalizedCodeTask): CodeFile[] {
  const solved = new Map(task.solution.map((f) => [f.name, f.content]));
  return task.code.files.map((f) => ({ name: f.name, content: solved.get(f.name) ?? f.content }));
}

export function allChecks(code: CodeTask, hiddenChecks: CheckRuleDoc[]): CheckRuleDoc[] {
  return [...code.steps.flatMap((step) => step.checks), ...hiddenChecks];
}

type CheckLine = { id: string; label: string; onStarter: boolean; onSolution: boolean; detail: string };

export type CodeTaskReport = {
  ok: boolean;
  /** Problems that stop the task from being saved. */
  errors: string[];
  /** Saved anyway, but worth fixing. */
  warnings: string[];
  steps: { title: string; checks: CheckLine[] }[];
  hidden: CheckLine[];
  /** How many variant combinations were tried (1 without variables). */
  variants: number;
};

function describeValues(values: VariantValues): string {
  return Object.entries(values)
    .filter(([key]) => !key.startsWith("student."))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

/**
 * Runs every check on the starter files and on the solution, once per variant
 * combination (each value of each variable at least once), for agents and the studio.
 */
export function testCodeTask(input: CodeQuestionInput): CodeTaskReport {
  let task: NormalizedCodeTask;
  try {
    task = normalizeCodeTaskShape(input);
  } catch (error) {
    const message =
      error instanceof ConvexError
        ? String((error.data as { message?: string }).message)
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, errors: [message], warnings: [], steps: [], hidden: [], variants: 0 };
  }
  const variables = task.code.variables ?? [];
  const combos = sampleCount(variables);
  const rules = allChecks(task.code, task.hiddenChecks) as CheckRule[];
  const starterPass = new Map<string, boolean>();
  const solutionPass = new Map<string, boolean>();
  const detail = new Map<string, string>();
  for (let k = 0; k < combos; k++) {
    const values = sampleValues(variables, k);
    const filled = rules.map((rule) => fillRule(rule, values));
    const onStarter = runChecks(fillFiles(task.code.files, values), filled);
    const onSolution = runChecks(fillFiles(solutionFiles(task), values), filled);
    for (const result of onStarter) {
      // A step "already done" on the starter is worth a warning if it is for the first variant.
      if (k === 0) starterPass.set(result.id, result.passed);
    }
    for (const result of onSolution) {
      if (solutionPass.get(result.id) === false) continue;
      solutionPass.set(result.id, result.passed);
      if (!result.passed) {
        detail.set(result.id, variables.length > 0 ? `${result.detail} (with ${describeValues(values)})` : result.detail);
      }
    }
  }
  const line = (rule: CheckRuleDoc): CheckLine => ({
    id: rule.id,
    label: rule.label,
    onStarter: starterPass.get(rule.id) ?? false,
    onSolution: solutionPass.get(rule.id) ?? false,
    detail: detail.get(rule.id) ?? "",
  });
  const steps = task.code.steps.map((step) => ({ title: step.title, checks: step.checks.map(line) }));
  const hidden = task.hiddenChecks.map(line);
  const errors: string[] = [];
  const warnings: string[] = [];
  steps.forEach((step, s) => {
    for (const check of step.checks) {
      if (!check.onSolution) {
        errors.push(`Step ${s + 1} (“${step.title}”), check “${check.label}” fails on the solution: ${check.detail}`);
      }
    }
    if (step.checks.every((check) => check.onStarter)) {
      warnings.push(`Step ${s + 1} (“${step.title}”) already passes on the starter files, so students skip it.`);
    }
  });
  for (const check of hidden) {
    if (!check.onSolution) {
      errors.push(`Hidden check “${check.label}” fails on the solution: ${check.detail}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, steps, hidden, variants: combos };
}

/** For saving: the normalised task, or an error listing what the solution fails. */
export function normalizeCodeTask(input: CodeQuestionInput): NormalizedCodeTask {
  const task = normalizeCodeTaskShape(input);
  const report = testCodeTask(input);
  if (!report.ok) {
    const shown = report.errors.slice(0, 6);
    const more = report.errors.length - shown.length;
    throw appError(
      "INVALID_INPUT",
      `The solution must pass every check. ${shown.join(" ")}${more > 0 ? ` (and ${more} more)` : ""} Run the task check (check_code_task) to see the full report.`,
    );
  }
  return task;
}

const checkLineValidator = v.object({
  id: v.string(),
  label: v.string(),
  onStarter: v.boolean(),
  onSolution: v.boolean(),
  detail: v.string(),
});

export const codeTaskReportValidator = v.object({
  ok: v.boolean(),
  errors: v.array(v.string()),
  warnings: v.array(v.string()),
  steps: v.array(v.object({ title: v.string(), checks: v.array(checkLineValidator) })),
  hidden: v.array(checkLineValidator),
  variants: v.number(),
});
