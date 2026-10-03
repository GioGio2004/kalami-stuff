"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { CodeEditor } from "@/components/sandbox/CodeEditor";
import { Button } from "@/components/ui/buttons";
import { FormError } from "@/components/ui/form";
import { ArrowDown, ArrowUp, Check, Cross, Plus } from "@/components/ui/icons";
import { testCodeTask } from "@/convex/model/codeTasks";
import { errorMessage } from "@/lib/errors";
import { FullScreen } from "./TaskTryout";
import type { QuestionInput, QuestionWithKey } from "./types";

/**
 * Write or edit a code task by hand: what agents do over MCP, as a form. The
 * report on the right runs every check on the starter and the solution as you
 * type, so you see straight away whether the task can be finished.
 */

type CodeInput = Extract<QuestionInput, { type: "code" }>;
type RuleInput = CodeInput["steps"][number]["checks"][number];
type RuleType = RuleInput["type"];

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: "exists", label: "Element exists" },
  { value: "not_exists", label: "Element doesn't exist" },
  { value: "count", label: "Number of elements" },
  { value: "text", label: "Text of an element" },
  { value: "attr", label: "Attribute" },
  { value: "css", label: "CSS value" },
  { value: "linked", label: "Stylesheet linked" },
];

type RuleDraft = {
  key: string;
  type: RuleType;
  label: string;
  selector: string;
  property: string;
  attribute: string;
  href: string;
  value: string;
  /** text and attr: how `value` is compared; css: one value or a comma list. */
  match: "equals" | "contains" | "present" | "oneOf";
  min: string;
  max: string;
  viewport: string;
  every: "default" | "yes" | "no";
};

type StepDraft = { key: string; title: string; instructions: string; hint: string; checks: RuleDraft[] };

type Draft = {
  prompt: string;
  points: string;
  starter: { name: string; content: string }[];
  solution: { name: string; content: string }[];
  steps: StepDraft[];
  hidden: RuleDraft[];
  assets: { key: string; name: string; url: string; alt: string }[];
  variables: { key: string; name: string; values: string }[];
};

let counter = 0;
const newKey = () => `k${++counter}`;

function blankRule(type: RuleType = "exists"): RuleDraft {
  return {
    key: newKey(),
    type,
    label: "",
    selector: "",
    property: "",
    attribute: "",
    href: "style.css",
    value: "",
    match: type === "attr" ? "present" : type === "text" ? "contains" : "equals",
    min: "",
    max: "",
    viewport: "",
    every: "default",
  };
}

function blankStep(): StepDraft {
  return { key: newKey(), title: "", instructions: "", hint: "", checks: [blankRule()] };
}

const STARTER_HTML =
  '<!DOCTYPE html>\n<html lang="ka">\n<head>\n  <meta charset="UTF-8">\n  <title>My page</title>\n</head>\n<body>\n\n</body>\n</html>\n';

function ruleFromInput(rule: RuleInput): RuleDraft {
  const draft = { ...blankRule(rule.type), label: rule.label };
  switch (rule.type) {
    case "linked":
      return { ...draft, href: rule.href };
    case "exists":
    case "not_exists":
      return { ...draft, selector: rule.selector };
    case "count":
      return { ...draft, selector: rule.selector, min: rule.min?.toString() ?? "", max: rule.max?.toString() ?? "" };
    case "text":
      return {
        ...draft,
        selector: rule.selector,
        match: rule.equals !== undefined ? "equals" : "contains",
        value: rule.equals ?? rule.contains ?? "",
        every: rule.every === undefined ? "default" : rule.every ? "yes" : "no",
      };
    case "attr":
      return {
        ...draft,
        selector: rule.selector,
        attribute: rule.attribute,
        match: rule.equals !== undefined ? "equals" : rule.contains !== undefined ? "contains" : "present",
        value: rule.equals ?? rule.contains ?? "",
        every: rule.every === undefined ? "default" : rule.every ? "yes" : "no",
      };
    case "css":
      return {
        ...draft,
        selector: rule.selector,
        property: rule.property,
        match: rule.oneOf ? "oneOf" : "equals",
        value: rule.oneOf ? rule.oneOf.join(", ") : (rule.equals ?? ""),
        viewport: rule.viewport?.toString() ?? "",
        every: rule.every === undefined ? "default" : rule.every ? "yes" : "no",
      };
  }
}

function ruleToInput(rule: RuleDraft): RuleInput {
  const every = rule.every === "default" ? undefined : rule.every === "yes";
  const number = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const label = rule.label;
  switch (rule.type) {
    case "linked":
      return { type: "linked", label, href: rule.href };
    case "exists":
    case "not_exists":
      return { type: rule.type, label, selector: rule.selector };
    case "count":
      return { type: "count", label, selector: rule.selector, min: number(rule.min), max: number(rule.max) };
    case "text":
      return {
        type: "text",
        label,
        selector: rule.selector,
        equals: rule.match === "equals" ? rule.value : undefined,
        contains: rule.match === "equals" ? undefined : rule.value,
        every,
      };
    case "attr":
      return {
        type: "attr",
        label,
        selector: rule.selector,
        attribute: rule.attribute,
        equals: rule.match === "equals" ? rule.value : undefined,
        contains: rule.match === "contains" ? rule.value : undefined,
        every,
      };
    case "css":
      return {
        type: "css",
        label,
        selector: rule.selector,
        property: rule.property,
        equals: rule.match === "oneOf" ? undefined : rule.value,
        oneOf:
          rule.match === "oneOf"
            ? rule.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : undefined,
        viewport: number(rule.viewport),
        every,
      };
  }
}

function fromQuestion(question: QuestionWithKey | undefined): Draft {
  if (!question?.code || question.key.type !== "code") {
    return {
      prompt: "",
      points: "10",
      starter: [
        { name: "index.html", content: STARTER_HTML },
        { name: "style.css", content: "" },
      ],
      solution: [
        { name: "index.html", content: STARTER_HTML },
        { name: "style.css", content: "" },
      ],
      steps: [blankStep()],
      hidden: [],
      assets: [],
      variables: [],
    };
  }
  const { code, key } = question;
  const solved = new Map(key.solution.map((f) => [f.name, f.content]));
  // ruleFromInput copies only the fields it knows, so the stored id is dropped.
  const strip = (rule: { id: string } & RuleInput) => ruleFromInput(rule);
  return {
    prompt: question.prompt,
    points: String(question.points),
    starter: code.files,
    solution: code.files.map((f) => ({ name: f.name, content: solved.get(f.name) ?? f.content })),
    steps: code.steps.map((step) => ({
      key: newKey(),
      title: step.title,
      instructions: step.instructions,
      hint: step.hint ?? "",
      checks: step.checks.map((rule) => strip(rule as { id: string } & RuleInput)),
    })),
    hidden: key.hiddenChecks.map((rule) => strip(rule as { id: string } & RuleInput)),
    assets: code.assets.map((a) => ({ key: newKey(), name: a.name, url: a.url, alt: a.alt ?? "" })),
    variables: (code.variables ?? []).map((v) => ({ key: newKey(), name: v.name, values: v.values.join("\n") })),
  };
}

function toInput(draft: Draft): CodeInput {
  return {
    type: "code",
    prompt: draft.prompt,
    points: draft.points.trim() === "" ? undefined : Number(draft.points),
    starterFiles: draft.starter,
    solution: draft.solution,
    steps: draft.steps.map((step) => ({
      title: step.title,
      instructions: step.instructions,
      hint: step.hint.trim() === "" ? undefined : step.hint,
      checks: step.checks.map(ruleToInput),
    })),
    hiddenChecks: draft.hidden.map(ruleToInput),
    assets: draft.assets.map((a) => ({ name: a.name.trim(), url: a.url.trim(), alt: a.alt.trim() || undefined })),
    variables: draft.variables.map((v) => ({
      name: v.name.trim(),
      values: v.values
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    })),
  };
}

const input = "h-9 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-ink";
const area = "w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink";
const small = "text-xs font-medium text-graphite";

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const target = index + by;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function Status({ onSolution, onStarter }: { onSolution?: boolean; onStarter?: boolean }) {
  if (onSolution === undefined) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px]" title="Solution / starter">
      <span className={`grid size-5 place-items-center rounded-full ${onSolution ? "bg-highlighter" : "bg-red-pen/15 text-red-pen"}`}>
        {onSolution ? <Check className="size-3" /> : <Cross className="size-3" />}
      </span>
      {onStarter && <span className="text-warn">passes on starter</span>}
    </span>
  );
}

function RuleEditor({
  rule,
  status,
  onChange,
  onRemove,
}: {
  rule: RuleDraft;
  status?: { onSolution: boolean; onStarter: boolean; detail: string };
  onChange: (rule: RuleDraft) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...rule, ...patch });
  const needsSelector = rule.type !== "linked";
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <select
          value={rule.type}
          onChange={(e) => onChange({ ...blankRule(e.target.value as RuleType), key: rule.key, label: rule.label, selector: rule.selector })}
          className={`${input} w-auto`}
          aria-label="Check type"
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <Status onSolution={status?.onSolution} onStarter={status?.onStarter} />
        <button onClick={onRemove} className="ml-auto text-xs text-graphite hover:text-red-pen" type="button">
          Remove
        </button>
      </div>
      <input
        value={rule.label}
        onChange={(e) => set({ label: e.target.value })}
        placeholder='What the student reads, e.g. "Your page has a <nav>"'
        className={`${input} mt-2`}
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {needsSelector && (
          <input value={rule.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="Selector, e.g. nav ul li" className={`${input} font-mono`} />
        )}
        {rule.type === "linked" && (
          <input value={rule.href} onChange={(e) => set({ href: e.target.value })} placeholder="style.css" className={`${input} font-mono`} />
        )}
        {rule.type === "count" && (
          <div className="flex gap-2">
            <input value={rule.min} onChange={(e) => set({ min: e.target.value })} placeholder="min" inputMode="numeric" className={input} />
            <input value={rule.max} onChange={(e) => set({ max: e.target.value })} placeholder="max" inputMode="numeric" className={input} />
          </div>
        )}
        {rule.type === "attr" && (
          <input value={rule.attribute} onChange={(e) => set({ attribute: e.target.value })} placeholder="Attribute, e.g. alt" className={`${input} font-mono`} />
        )}
        {rule.type === "css" && (
          <input value={rule.property} onChange={(e) => set({ property: e.target.value })} placeholder="Property, e.g. display" className={`${input} font-mono`} />
        )}
        {(rule.type === "text" || rule.type === "attr" || rule.type === "css") && (
          <div className="flex gap-2 sm:col-span-2">
            <select value={rule.match} onChange={(e) => set({ match: e.target.value as RuleDraft["match"] })} className={`${input} w-auto`}>
              {rule.type === "css" ? (
                <>
                  <option value="equals">is</option>
                  <option value="oneOf">is one of (comma list)</option>
                </>
              ) : (
                <>
                  {rule.type === "attr" && <option value="present">is present</option>}
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                </>
              )}
            </select>
            {rule.match !== "present" && (
              <input value={rule.value} onChange={(e) => set({ value: e.target.value })} placeholder={rule.type === "css" ? "flex  ·  #e63946  ·  0 auto  ·  {{color}}" : "text"} className={`${input} font-mono`} />
            )}
          </div>
        )}
        {(rule.type === "text" || rule.type === "attr" || rule.type === "css") && (
          <select value={rule.every} onChange={(e) => set({ every: e.target.value as RuleDraft["every"] })} className={input} aria-label="Which elements">
            <option value="default">{rule.type === "text" ? "One matching element is enough" : "Every matching element"} (default)</option>
            <option value="yes">Every matching element</option>
            <option value="no">One matching element is enough</option>
          </select>
        )}
        {rule.type === "css" && (
          <input value={rule.viewport} onChange={(e) => set({ viewport: e.target.value })} placeholder="Screen width for @media (default 1280)" inputMode="numeric" className={input} />
        )}
      </div>
      {status && !status.onSolution && status.detail && <p className="mt-2 text-xs text-red-pen">Solution: {status.detail}</p>}
    </div>
  );
}

export function CodeTaskForm({
  question,
  onSubmit,
  onCancel,
}: {
  question?: QuestionWithKey;
  onSubmit: (input: QuestionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromQuestion(question));
  const [filesMode, setFilesMode] = useState<"starter" | "solution">("starter");
  const [activeFile, setActiveFile] = useState("index.html");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deferred = useDeferredValue(draft);
  const report = useMemo(() => testCodeTask(toInput(deferred)), [deferred]);

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  const setStep = (index: number, changes: Partial<StepDraft>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...changes } : s)) }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toInput(draft));
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const files = filesMode === "starter" ? draft.starter : draft.solution;

  return (
    <FullScreen label={question ? "Edit code task" : "New code task"} onClose={onCancel}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="-rotate-1 font-hand text-[1.4rem] leading-none text-graphite">{question ? "Fix it up" : "Step by step"}</p>
            <h2 className="text-2xl font-medium tracking-[-0.02em]">{question ? "Edit code task" : "New code task"}</h2>
          </div>
          <span className={`text-sm ${report.ok ? "text-ok" : "text-red-pen"}`}>
            {report.ok ? "The solution passes every check" : `${report.errors.length} problem${report.errors.length === 1 ? "" : "s"} to fix`}
          </span>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="lime" onClick={save} disabled={busy || !report.ok}>
            <Check className="size-4" />
            {busy ? "Saving…" : "Save task"}
          </Button>
        </div>
        {error && <FormError>{error}</FormError>}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* The task */}
          <div className="min-h-0 space-y-4 overflow-y-auto rounded-[1.6rem] bg-panel p-4 sm:p-5">
            <section className="space-y-2 rounded-2xl bg-card p-4">
              <label className={small} htmlFor="ct-prompt">
                What students build (shown above the steps, Markdown)
              </label>
              <textarea id="ct-prompt" rows={3} value={draft.prompt} onChange={(e) => patch({ prompt: e.target.value })} className={area} />
              <label className="flex items-center gap-2 text-sm">
                Points
                <input value={draft.points} onChange={(e) => patch({ points: e.target.value })} inputMode="decimal" className={`${input} w-24`} />
                <span className="text-xs text-graphite">The score is points × checks passed ÷ all checks.</span>
              </label>
            </section>

            <section className="space-y-3">
              <h3 className="px-1 text-lg font-medium">Steps</h3>
              {draft.steps.map((step, s) => (
                <div key={step.key} className="space-y-2 rounded-2xl bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-paper">{s + 1}</span>
                    <input value={step.title} onChange={(e) => setStep(s, { title: e.target.value })} placeholder="Step title, e.g. Link your stylesheet" className={`${input} font-medium`} />
                    <button type="button" aria-label="Move step up" onClick={() => patch({ steps: move(draft.steps, s, -1) })} className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-panel">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" aria-label="Move step down" onClick={() => patch({ steps: move(draft.steps, s, 1) })} className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-panel">
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ steps: draft.steps.filter((_, i) => i !== s) })}
                      disabled={draft.steps.length === 1}
                      className="shrink-0 text-xs text-graphite hover:text-red-pen disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={step.instructions}
                    onChange={(e) => setStep(s, { instructions: e.target.value })}
                    placeholder={"What to add and why. Markdown: `code`, **bold**, ```html blocks```."}
                    className={area}
                  />
                  <input value={step.hint} onChange={(e) => setStep(s, { hint: e.target.value })} placeholder="Hint (optional), shown when the student asks" className={input} />
                  <p className={small}>Checks (ticked live as the student types)</p>
                  {step.checks.map((rule, c) => (
                    <RuleEditor
                      key={rule.key}
                      rule={rule}
                      status={report.steps[s]?.checks[c]}
                      onChange={(next) => setStep(s, { checks: step.checks.map((r, i) => (i === c ? next : r)) })}
                      onRemove={() => setStep(s, { checks: step.checks.filter((_, i) => i !== c) })}
                    />
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setStep(s, { checks: [...step.checks, blankRule()] })}>
                    <Plus className="size-4" /> Add check
                  </Button>
                </div>
              ))}
              <Button size="sm" onClick={() => patch({ steps: [...draft.steps, blankStep()] })}>
                <Plus className="size-4" /> Add step
              </Button>
            </section>

            <section className="space-y-2 rounded-2xl bg-card p-4">
              <h3 className="text-lg font-medium">Checked on submit</h3>
              <p className="text-xs text-graphite">Hidden checks. Students see them only with full results.</p>
              {draft.hidden.map((rule, h) => (
                <RuleEditor
                  key={rule.key}
                  rule={rule}
                  status={report.hidden[h]}
                  onChange={(next) => patch({ hidden: draft.hidden.map((r, i) => (i === h ? next : r)) })}
                  onRemove={() => patch({ hidden: draft.hidden.filter((_, i) => i !== h) })}
                />
              ))}
              <Button size="sm" variant="outline" onClick={() => patch({ hidden: [...draft.hidden, blankRule()] })}>
                <Plus className="size-4" /> Add hidden check
              </Button>
            </section>

            <section className="space-y-2 rounded-2xl bg-card p-4">
              <h3 className="text-lg font-medium">Variants</h3>
              <p className="text-xs leading-relaxed text-graphite">
                Each student gets one value of each variable. Write <code className="font-mono">{"{{name}}"}</code> in
                steps, checks, files and the solution. <code className="font-mono">{"{{student.firstName}}"}</code> is the
                student&apos;s first name.
              </p>
              {draft.variables.map((variable, i) => (
                <div key={variable.key} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                  <input
                    value={variable.name}
                    onChange={(e) => patch({ variables: draft.variables.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)) })}
                    placeholder="color"
                    className={`${input} font-mono`}
                  />
                  <textarea
                    rows={2}
                    value={variable.values}
                    onChange={(e) => patch({ variables: draft.variables.map((v, j) => (j === i ? { ...v, values: e.target.value } : v)) })}
                    placeholder={"One value per line\n#e63946"}
                    className={`${area} font-mono`}
                  />
                  <button type="button" onClick={() => patch({ variables: draft.variables.filter((_, j) => j !== i) })} className="text-xs text-graphite hover:text-red-pen">
                    Remove
                  </button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => patch({ variables: [...draft.variables, { key: newKey(), name: "", values: "" }] })}>
                <Plus className="size-4" /> Add variable
              </Button>
            </section>

            <section className="space-y-2 rounded-2xl bg-card p-4">
              <h3 className="text-lg font-medium">Images</h3>
              <p className="text-xs text-graphite">ImageKit URLs. Students use the short name, e.g. &lt;img src=&quot;cat.jpg&quot;&gt;.</p>
              {draft.assets.map((asset, i) => (
                <div key={asset.key} className="grid gap-2 sm:grid-cols-[9rem_1fr_9rem_auto]">
                  <input value={asset.name} onChange={(e) => patch({ assets: draft.assets.map((a, j) => (j === i ? { ...a, name: e.target.value } : a)) })} placeholder="cat.jpg" className={`${input} font-mono`} />
                  <input value={asset.url} onChange={(e) => patch({ assets: draft.assets.map((a, j) => (j === i ? { ...a, url: e.target.value } : a)) })} placeholder="https://ik.imagekit.io/…" className={input} />
                  <input value={asset.alt} onChange={(e) => patch({ assets: draft.assets.map((a, j) => (j === i ? { ...a, alt: e.target.value } : a)) })} placeholder="Alt text" className={input} />
                  <button type="button" onClick={() => patch({ assets: draft.assets.filter((_, j) => j !== i) })} className="text-xs text-graphite hover:text-red-pen">
                    Remove
                  </button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => patch({ assets: [...draft.assets, { key: newKey(), name: "", url: "", alt: "" }] })}>
                <Plus className="size-4" /> Add image
              </Button>
            </section>
          </div>

          {/* Files and the report */}
          <div className="flex min-h-0 flex-col gap-3">
            <section className="flex min-h-[22rem] flex-1 flex-col overflow-hidden rounded-[1.6rem] bg-card">
              <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
                {(["starter", "solution"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilesMode(mode)}
                    className={`h-8 rounded-full px-3.5 text-sm font-medium transition ${filesMode === mode ? "bg-ink text-paper" : "text-graphite hover:bg-panel"}`}
                  >
                    {mode === "starter" ? "Starter files" : "Solution"}
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-line" />
                {files.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => setActiveFile(file.name)}
                    className={`h-8 rounded-full px-3 font-mono text-[13px] transition ${activeFile === file.name ? "bg-panel text-ink" : "text-graphite hover:text-ink"}`}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  key={filesMode}
                  files={files}
                  active={activeFile}
                  revision={0}
                  readOnly={false}
                  locked={false}
                  locale="en"
                  mistakes={[]}
                  comments={[]}
                  onChange={(name, content) =>
                    setDraft((d) => {
                      const which = filesMode === "starter" ? "starter" : "solution";
                      return { ...d, [which]: d[which].map((f) => (f.name === name ? { ...f, content } : f)) };
                    })
                  }
                />
              </div>
            </section>

            <section className="max-h-[40%] overflow-y-auto rounded-[1.6rem] bg-card p-4">
              <h3 className="text-lg font-medium">Can students finish it?</h3>
              <p className="text-xs text-graphite">
                Every check runs on the starter files and on the solution
                {report.variants > 1 ? `, for each of ${report.variants} variant combinations` : ""}.
              </p>
              {report.errors.length === 0 && report.warnings.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-ok">
                  <Check className="size-4" /> All good: the solution passes every check, and no step is done before it starts.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {report.errors.map((message, i) => (
                    <li key={`e${i}`} className="flex gap-2 text-red-pen">
                      <Cross className="mt-0.5 size-4 shrink-0" /> {message}
                    </li>
                  ))}
                  {report.warnings.map((message, i) => (
                    <li key={`w${i}`} className="flex gap-2 text-warn">
                      <span className="mt-0.5 shrink-0">!</span> {message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </FullScreen>
  );
}
