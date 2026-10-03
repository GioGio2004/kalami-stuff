"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { CheckCard, Field, FormError, Segmented, TextArea, TextInput } from "@/components/ui/form";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Plus, Robot } from "@/components/ui/icons";
import { Pill, statusLabel, statusTone } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { QuestionForm } from "./QuestionForm";
import { Submissions } from "./Submissions";
import { CodeTaskForm } from "./CodeTaskForm";
import { TaskTryout } from "./TaskTryout";
import {
  INTEGRITY_LABEL,
  KIND_LABEL,
  RESULTS_LABEL,
  TYPE_LABEL,
  type AssessmentDetail,
  type AssessmentKind,
  type AssessmentSettings,
  type AssessmentStatus,
  type QuestionInput,
  type QuestionWithKey,
  type UpdateAssessmentArgs,
} from "./types";

const KINDS = (Object.keys(KIND_LABEL) as AssessmentKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));
const INTEGRITY = (Object.keys(INTEGRITY_LABEL) as AssessmentSettings["integrityLevel"][]).map((value) => ({
  value,
  label: INTEGRITY_LABEL[value],
}));
const RESULTS = (Object.keys(RESULTS_LABEL) as AssessmentSettings["resultsVisibility"][]).map((value) => ({
  value,
  label: RESULTS_LABEL[value],
}));

const INTEGRITY_HINT: Record<AssessmentSettings["integrityLevel"], string> = {
  off: "Practice: no monitoring at all. Good for self-checks.",
  standard: "Standard: notes when a student leaves the tab or window, for you to review afterwards.",
  strict: "Strict: needs fullscreen and locks the attempt after repeated exits. For exams.",
};

const RESULTS_HINT: Record<AssessmentSettings["resultsVisibility"], string> = {
  hidden: "Hidden: students only see that their answers were submitted.",
  score: "Score only: students see their total, not which answers were right.",
  full_after_close: "Full, after close: once it closes, students see every answer, the correct ones and your explanations.",
};

export function AssessmentBuilder({
  detail,
  onUpdate,
  onSetStatus,
  onDelete,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onReorder,
}: {
  detail: AssessmentDetail;
  onUpdate: (args: UpdateAssessmentArgs) => Promise<void>;
  onSetStatus: (status: AssessmentStatus) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddQuestion: (input: QuestionInput) => Promise<void>;
  onUpdateQuestion: (questionId: QuestionWithKey["_id"], input: QuestionInput) => Promise<void>;
  onDeleteQuestion: (questionId: QuestionWithKey["_id"]) => Promise<void>;
  onReorder: (questionIds: QuestionWithKey["_id"][]) => Promise<void>;
}) {
  const { assessment, questions, canEdit, course } = detail;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<QuestionWithKey | null>(null);
  const [trying, setTrying] = useState<QuestionWithKey | null>(null);
  const [codeForm, setCodeForm] = useState<{ question?: QuestionWithKey } | null>(null);
  const hasCode = questions.some((q) => q.type === "code");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function move(index: number, direction: -1 | 1) {
    const ids = questions.map((q) => q._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) {
      return;
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(() => onReorder(ids));
  }

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-8 sm:px-10 sm:pb-8 sm:pt-10 lg:px-12">
      <Link href={`/courses/${course._id}`} className="inline-flex items-center gap-2 text-sm text-graphite hover:text-ink">
        <ArrowLeft className="size-4" />
        {course.title}
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 px-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="ink">{KIND_LABEL[assessment.kind]}</Pill>
            <Pill tone={statusTone(assessment.status)}>{statusLabel(assessment.status)}</Pill>
            {assessment.createdVia === "mcp" && (
              <Pill tone="lime">
                <Robot className="size-3.5" />
                Drafted by an agent
              </Pill>
            )}
            {!canEdit && <Pill>Read only</Pill>}
          </div>
          <h1 className="mt-3 text-4xl font-medium leading-[0.98] tracking-[-0.04em] sm:text-5xl">{assessment.title}</h1>
          <p className="mt-3 text-[15px] text-graphite">
            {assessment.questionCount} question{assessment.questionCount === 1 ? "" : "s"} · {assessment.totalPoints} points
          </p>
        </div>
        {detail.canEdit && (
          <div className="flex flex-wrap gap-2.5">
            {assessment.status === "draft" && (
              <>
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete draft
                </Button>
                <Button variant="lime" onClick={() => act(() => onSetStatus("published"))} disabled={questions.length === 0}>
                  <Check className="size-4" />
                  Publish
                </Button>
              </>
            )}
            {assessment.status === "published" && (
              <>
                <Button variant="ghost" onClick={() => act(() => onSetStatus("archived"))}>
                  Archive
                </Button>
                <Button variant="outline" onClick={() => act(() => onSetStatus("draft"))}>
                  Move back to draft
                </Button>
              </>
            )}
            {assessment.status === "archived" && (
              <Button variant="outline" onClick={() => act(() => onSetStatus("draft"))}>
                Restore as draft
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 max-w-3xl px-1 text-sm leading-relaxed text-graphite">
        {statusNote(assessment.status, questions.length, canEdit)}
      </p>
      {actionError && (
        <div className="mt-4">
          <FormError>{actionError}</FormError>
        </div>
      )}

      <div className="mt-8 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <section className="rounded-[2rem] bg-card p-5 sm:p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-medium tracking-tight">Questions</h2>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={assessment.kind === "task" ? "lime" : "outline"} onClick={() => setCodeForm({})}>
                  <Plus className="size-4" />
                  Code task
                </Button>
                <Button size="sm" variant={assessment.kind === "task" ? "outline" : "ink"} onClick={() => setAdding(true)}>
                  <Plus className="size-4" />
                  Question
                </Button>
              </div>
            )}
          </div>

          {questions.length === 0 ? (
            <div className="mt-4 rounded-2xl border-2 border-dashed border-line p-6 text-center">
              <p className="font-medium">No questions yet</p>
              <p className="mt-1 text-sm text-graphite">
                Add them one by one, or ask your agent:{" "}
                <span className="font-hand text-lg text-ink">“add 10 questions to ‘{assessment.title}’”</span>
              </p>
            </div>
          ) : (
            <ol className="mt-4 space-y-3">
              {questions.map((question, index) => (
                <li key={question._id}>
                  <QuestionCard
                    question={question}
                    index={index}
                    total={questions.length}
                    canEdit={canEdit}
                    onEdit={() => (question.type === "code" ? setCodeForm({ question }) : setEditing(question))}
                    onTry={() => setTrying(question)}
                    onDelete={() => act(() => onDeleteQuestion(question._id))}
                    onMove={(direction) => move(index, direction)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-4 lg:col-span-5">
          <SettingsCard key={assessment._id} assessment={assessment} canEdit={canEdit} onUpdate={onUpdate} />
          {(hasCode || assessment.status !== "draft") && <Submissions detail={detail} />}
        </div>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} label="New question">
        {adding && (
          <QuestionForm
            onSubmit={async (input) => {
              await onAddQuestion(input);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} label="Edit question">
        {editing && (
          <QuestionForm
            question={editing}
            onSubmit={async (input) => {
              await onUpdateQuestion(editing._id, input);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>

      {trying && <TaskTryout question={trying} title={assessment.title} onClose={() => setTrying(null)} />}

      {codeForm && (
        <CodeTaskForm
          question={codeForm.question}
          onSubmit={async (input) => {
            if (codeForm.question) {
              await onUpdateQuestion(codeForm.question._id, input);
            } else {
              await onAddQuestion(input);
            }
            setCodeForm(null);
          }}
          onCancel={() => setCodeForm(null)}
        />
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete draft">
        {confirmDelete && (
          <DeleteDraft
            title={assessment.title}
            questionCount={questions.length}
            onDelete={onDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

/** One line under the title saying what the current status means and what to do next. */
function statusNote(status: AssessmentStatus, questionCount: number, canEdit: boolean): string {
  switch (status) {
    case "draft":
      if (!canEdit) {
        return "Draft: only staff can see it for now.";
      }
      return questionCount === 0
        ? "Draft: only you and other staff can see it. Add at least one question, then Publish to make it available to students."
        : "Draft: only you and other staff can see it. Check the questions and answer keys, then Publish to make it available to students.";
    case "published":
      return "Published: available to the course’s students from the opening time. Agents can’t change it any more. Move it back to draft to edit it with an agent, or archive it once it’s over.";
    case "archived":
      return "Archived: hidden from students and read-only. Restore it as a draft to reuse it.";
  }
}

function DeleteDraft({
  title,
  questionCount,
  onDelete,
  onCancel,
}: {
  title: string;
  questionCount: number;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-medium tracking-[-0.03em]">Delete this draft?</h2>
      <p className="mt-3 text-[15px] text-graphite">
        “{title}” and its {questionCount} question{questionCount === 1 ? "" : "s"} will be gone. This can’t be undone.
      </p>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  total,
  canEdit,
  onEdit,
  onTry,
  onDelete,
  onMove,
}: {
  question: QuestionWithKey;
  index: number;
  total: number;
  canEdit: boolean;
  onEdit: () => void;
  onTry: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { key } = question;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const correct = new Set(
    key.type === "single" ? [key.correctOptionId] : key.type === "multiple" ? key.correctOptionIds : [],
  );
  return (
    <article className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel text-sm font-semibold">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-graphite">
            <Pill>{TYPE_LABEL[question.type]}</Pill>
            <span className="tabular-nums">{question.points} pts</span>
            {question.createdVia === "mcp" && (
              <span className="inline-flex items-center gap-1">
                <Robot className="size-3.5" />
                agent
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{question.prompt}</p>
          {question.options && (
            <ul className="mt-3 space-y-1.5">
              {question.options.map((option, i) => {
                const right = correct.has(option.id);
                return (
                  <li key={option.id} className={`flex items-start gap-2.5 text-sm ${right ? "font-medium" : "text-ink/75"}`}>
                    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${right ? "bg-highlighter text-ink" : "bg-panel text-graphite"}`}>
                      {right ? <Check className="size-3" /> : String.fromCharCode(65 + i)}
                    </span>
                    {option.text}
                  </li>
                );
              })}
            </ul>
          )}
          {key.type === "short" && (
            <p className="mt-3 text-sm text-graphite">
              Accepted: <span className="text-ink">{key.acceptedAnswers.join(" · ")}</span>
              {key.caseSensitive && " (case sensitive)"}
            </p>
          )}
          {key.type === "essay" && key.rubric && (
            <p className="mt-3 text-sm text-graphite">
              Rubric: <span className="text-ink">{key.rubric}</span>
            </p>
          )}
          {question.code && (
            <CodeTaskSummary
              code={question.code}
              hiddenCount={key.type === "code" ? key.hiddenChecks.length : 0}
              onTry={onTry}
            />
          )}
          {question.explanation && <p className="mt-2 text-xs text-graphite">Explanation: {question.explanation}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex gap-1">
              <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
                <ArrowDown className="size-4" />
              </IconButton>
            </div>
            {confirmingDelete ? (
              <div className="flex flex-wrap justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" onClick={onDelete}>
                  Yes, delete
                </Button>
              </div>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={onEdit}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-ink disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {children}
    </button>
  );
}

function SettingsCard({
  assessment,
  canEdit,
  onUpdate,
}: {
  assessment: AssessmentDetail["assessment"];
  canEdit: boolean;
  onUpdate: (args: UpdateAssessmentArgs) => Promise<void>;
}) {
  const [title, setTitleState] = useState(assessment.title);
  const [instructions, setInstructionsState] = useState(assessment.instructions ?? "");
  const [kind, setKindState] = useState(assessment.kind);
  const [settings, setSettings] = useState(assessment.settings);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  // Someone else (an agent, another tab) changed the assessment: show their
  // version, unless the form holds edits that haven't been saved yet.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(assessment.updatedAt);
  if (assessment.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(assessment.updatedAt);
    if (!dirty) {
      setTitleState(assessment.title);
      setInstructionsState(assessment.instructions ?? "");
      setKindState(assessment.kind);
      setSettings(assessment.settings);
    }
  }

  const setTitle = (value: string) => {
    setTitleState(value);
    setDirty(true);
  };
  const setInstructions = (value: string) => {
    setInstructionsState(value);
    setDirty(true);
  };
  const setKind = (value: AssessmentKind) => {
    setKindState(value);
    setDirty(true);
  };

  useEffect(() => {
    if (state !== "saved") {
      return;
    }
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const set = (changes: Partial<AssessmentSettings>) => {
    setSettings((s) => ({ ...s, ...changes }));
    setDirty(true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    setError(null);
    try {
      await onUpdate({ title, instructions, kind, settings });
      setDirty(false);
      setState("saved");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[2rem] bg-card p-5 sm:p-6">
      <h2 className="text-xl font-medium tracking-tight">Settings</h2>
      {canEdit && (
        <p className="mt-1 text-sm text-graphite">
          Questions save as you go. Settings save when you press the button at the bottom.
        </p>
      )}
      <fieldset disabled={!canEdit} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="a-title">
          <TextInput id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </Field>
        <Field
          label="Kind"
          hint={kind !== assessment.kind ? "Changing the kind keeps the settings below as they are; adjust them if needed." : undefined}
        >
          <Segmented label="Kind" value={kind} options={KINDS} onChange={setKind} />
        </Field>
        <Field label="Instructions" htmlFor="a-instructions" optional hint="Shown on the start screen before the timer begins.">
          <TextArea id="a-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} maxLength={8000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opens" htmlFor="a-opens" optional hint="Your local time. Empty: opens as soon as it’s published.">
            <TextInput id="a-opens" type="datetime-local" value={toLocalInputValue(settings.opensAt)} onChange={(e) => set({ opensAt: fromLocalInputValue(e.target.value) })} />
          </Field>
          <Field label="Closes" htmlFor="a-closes" optional hint="Hard deadline; open attempts are submitted then. Empty: no deadline.">
            <TextInput id="a-closes" type="datetime-local" value={toLocalInputValue(settings.closesAt)} onChange={(e) => set({ closesAt: fromLocalInputValue(e.target.value) })} />
          </Field>
          <Field label="Time limit (min)" htmlFor="a-time" optional hint="Per attempt, counted from when the student starts. Empty: untimed.">
            <TextInput
              id="a-time"
              type="number"
              min={1}
              max={600}
              value={settings.timeLimitMin ?? ""}
              onChange={(e) => set({ timeLimitMin: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
          <Field label="Attempts" htmlFor="a-attempts" hint="How many times each student may start it (1 to 10).">
            <TextInput
              id="a-attempts"
              type="number"
              min={1}
              max={10}
              value={settings.attemptsAllowed}
              onChange={(e) => set({ attemptsAllowed: Math.min(10, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
            />
          </Field>
        </div>
        <Field label="Integrity" hint={INTEGRITY_HINT[settings.integrityLevel]}>
          <Segmented label="Integrity level" value={settings.integrityLevel} options={INTEGRITY} onChange={(integrityLevel) => set({ integrityLevel })} />
        </Field>
        <Field label="Results for students" hint={RESULTS_HINT[settings.resultsVisibility]}>
          <Segmented label="Results visibility" value={settings.resultsVisibility} options={RESULTS} onChange={(resultsVisibility) => set({ resultsVisibility })} />
        </Field>
        <p className="text-xs leading-relaxed text-graphite">Shuffling gives every student their own order, which makes copying harder.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckCard checked={settings.shuffleQuestions} onChange={(shuffleQuestions) => set({ shuffleQuestions })}>
            Shuffle questions
          </CheckCard>
          <CheckCard checked={settings.shuffleOptions} onChange={(shuffleOptions) => set({ shuffleOptions })}>
            Shuffle options
          </CheckCard>
        </div>
        {error && <FormError>{error}</FormError>}
        {canEdit && (
          <div className="flex items-center justify-end gap-3 pt-1">
            {dirty && state === "idle" && <span className="text-sm text-graphite">Unsaved changes</span>}
            {state === "saved" && (
              <span className="inline-flex items-center gap-1.5 text-sm text-ok">
                <Check className="size-4" />
                Saved
              </span>
            )}
            <Button type="submit" disabled={state === "saving"}>
              Save settings
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

/** A code task in the question list: its steps and checks at a glance, and a way to try it. */
function CodeTaskSummary({
  code,
  hiddenCount,
  onTry,
}: {
  code: NonNullable<QuestionWithKey["code"]>;
  hiddenCount: number;
  onTry: () => void;
}) {
  const checkCount = code.steps.reduce((sum, step) => sum + step.checks.length, 0);
  return (
    <div className="mt-3 rounded-2xl bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite">
        <span className="font-mono">{code.files.map((f) => f.name).join(" · ")}</span>
        <span>
          {code.steps.length} step{code.steps.length === 1 ? "" : "s"} · {checkCount} check{checkCount === 1 ? "" : "s"}
          {hiddenCount > 0 && ` + ${hiddenCount} on submit`}
        </span>
        {code.assets.length > 0 && <span>{code.assets.length} image{code.assets.length === 1 ? "" : "s"}</span>}
      </div>
      <ol className="mt-3 space-y-1.5">
        {code.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-card text-[11px] font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{step.title}</span>
              <span className="text-graphite"> · {step.checks.map((c) => c.label).join(" · ")}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="lime" onClick={onTry}>
          Try it as a student
        </Button>
        <span className="text-xs text-graphite">Edit it by hand, or ask your agent to update this question.</span>
      </div>
    </div>
  );
}
