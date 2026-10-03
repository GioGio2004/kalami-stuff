"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { CheckCard, Field, FormError, Segmented, TextArea, TextInput } from "@/components/ui/form";
import { Cross, Plus } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";
import { TYPE_LABEL, type QuestionInput, type QuestionType, type QuestionWithKey } from "./types";

type Option = { text: string; correct: boolean };

type Draft = {
  type: QuestionType;
  prompt: string;
  points: string;
  explanation: string;
  options: Option[];
  acceptedAnswers: string;
  caseSensitive: boolean;
  rubric: string;
};

const TYPES = (Object.keys(TYPE_LABEL) as QuestionType[]).map((value) => ({ value, label: TYPE_LABEL[value] }));

const TYPE_HINT: Record<QuestionType, string> = {
  single: "Students pick one option. Marked automatically.",
  multiple: "Students tick every option they think is right. Marked automatically.",
  short: "Students type a word or short phrase, matched against your accepted answers.",
  essay: "Students write freely. You grade it by hand.",
};

function blankOptions(): Option[] {
  return [
    { text: "", correct: true },
    { text: "", correct: false },
    { text: "", correct: false },
  ];
}

/** Rebuilds the editable form from a stored question and its key. */
function fromQuestion(question: QuestionWithKey): Draft {
  const key = question.key;
  const correct = new Set(
    key.type === "single" ? [key.correctOptionId] : key.type === "multiple" ? key.correctOptionIds : [],
  );
  return {
    type: question.type,
    prompt: question.prompt,
    points: String(question.points),
    explanation: question.explanation ?? "",
    options: question.options?.map((o) => ({ text: o.text, correct: correct.has(o.id) })) ?? blankOptions(),
    acceptedAnswers: key.type === "short" ? key.acceptedAnswers.join("\n") : "",
    caseSensitive: key.type === "short" ? key.caseSensitive : false,
    rubric: key.type === "essay" ? (key.rubric ?? "") : "",
  };
}

function toInput(draft: Draft): QuestionInput {
  const points = draft.points.trim() === "" ? undefined : Number(draft.points);
  const base = {
    prompt: draft.prompt,
    points,
    explanation: draft.explanation.trim() === "" ? undefined : draft.explanation,
  };
  switch (draft.type) {
    case "single":
    case "multiple":
      return { type: draft.type, ...base, options: draft.options.filter((o) => o.text.trim() !== "") };
    case "short":
      return {
        type: "short",
        ...base,
        acceptedAnswers: draft.acceptedAnswers.split("\n").map((a) => a.trim()).filter(Boolean),
        caseSensitive: draft.caseSensitive,
      };
    case "essay":
      return { type: "essay", ...base, rubric: draft.rubric.trim() === "" ? undefined : draft.rubric };
  }
}

/** Add or edit one question. The server re-validates everything. */
export function QuestionForm({
  question,
  defaultType = "single",
  onSubmit,
  onCancel,
}: {
  question?: QuestionWithKey;
  defaultType?: QuestionType;
  onSubmit: (input: QuestionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    question
      ? fromQuestion(question)
      : {
          type: defaultType,
          prompt: "",
          points: "1",
          explanation: "",
          options: blankOptions(),
          acceptedAnswers: "",
          caseSensitive: false,
          rubric: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  const setOption = (index: number, changes: Partial<Option>) =>
    patch({
      options: draft.options.map((o, i) => {
        if (i !== index) {
          // A single-choice question has one correct option: picking one unpicks the rest.
          return changes.correct && draft.type === "single" ? { ...o, correct: false } : o;
        }
        return { ...o, ...changes };
      }),
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toInput(draft));
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const choice = draft.type === "single" || draft.type === "multiple";

  return (
    <form onSubmit={submit} className="space-y-5 p-6 sm:p-10">
      <div>
        <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">{question ? "Fix it up" : "One more"}</p>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">{question ? "Edit question" : "New question"}</h2>
      </div>

      <Field label="Type" hint={TYPE_HINT[draft.type]}>
        <Segmented
          label="Question type"
          value={draft.type}
          options={TYPES}
          onChange={(type) => {
            if (type === "single" && draft.options.filter((o) => o.correct).length > 1) {
              const first = draft.options.findIndex((o) => o.correct);
              patch({ type, options: draft.options.map((o, i) => ({ ...o, correct: i === first })) });
            } else {
              patch({ type });
            }
          }}
        />
      </Field>

      <Field label="Question" htmlFor="q-prompt" hint="What students read. Line breaks are kept.">
        <TextArea id="q-prompt" value={draft.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={3} maxLength={4000} autoFocus required />
      </Field>

      {choice && (
        <Field
          label="Options"
          hint={draft.type === "single" ? "Tick the one correct option." : "Tick every correct option."}
        >
          <ul className="space-y-2">
            {draft.options.map((option, index) => (
              <li key={index} className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center">
                  <input
                    type={draft.type === "single" ? "radio" : "checkbox"}
                    name="correct"
                    checked={option.correct}
                    onChange={(e) => setOption(index, { correct: e.target.checked })}
                    className="peer sr-only"
                    aria-label={`Option ${index + 1} is correct`}
                  />
                  <span
                    className={`grid size-9 place-items-center rounded-full border-2 text-xs font-semibold transition peer-focus-visible:ring-4 peer-focus-visible:ring-highlighter/70 ${
                      option.correct ? "border-ink bg-highlighter text-ink" : "border-line bg-card text-graphite"
                    }`}
                  >
                    {String.fromCharCode(65 + index)}
                  </span>
                </label>
                <TextInput
                  value={option.text}
                  onChange={(e) => setOption(index, { text: e.target.value })}
                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                  maxLength={500}
                  aria-label={`Option ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => patch({ options: draft.options.filter((_, i) => i !== index) })}
                  disabled={draft.options.length <= 2}
                  aria-label="Remove option"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-ink disabled:opacity-30"
                >
                  <Cross className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {draft.options.length < 10 && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => patch({ options: [...draft.options, { text: "", correct: false }] })}>
              <Plus className="size-4" />
              Add option
            </Button>
          )}
        </Field>
      )}

      {draft.type === "short" && (
        <>
          <Field label="Accepted answers" htmlFor="q-accepted" hint="One per line. Spaces around an answer are ignored.">
            <TextArea id="q-accepted" value={draft.acceptedAnswers} onChange={(e) => patch({ acceptedAnswers: e.target.value })} rows={3} required />
          </Field>
          <CheckCard checked={draft.caseSensitive} onChange={(caseSensitive) => patch({ caseSensitive })}>
            Case sensitive
          </CheckCard>
        </>
      )}

      {draft.type === "essay" && (
        <Field label="Rubric" htmlFor="q-rubric" optional hint="Your grading notes. Students never see this.">
          <TextArea id="q-rubric" value={draft.rubric} onChange={(e) => patch({ rubric: e.target.value })} rows={3} maxLength={4000} />
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
        <Field label="Points" htmlFor="q-points" hint="Halves are fine (0.5). 0 makes it an unscored question.">
          <TextInput id="q-points" type="number" min={0} max={100} step={0.5} value={draft.points} onChange={(e) => patch({ points: e.target.value })} />
        </Field>
        <Field label="Explanation" htmlFor="q-explanation" optional hint="Why the answer is right. Students see it only if results are set to “Full, after close”.">
          <TextInput id="q-explanation" value={draft.explanation} onChange={(e) => patch({ explanation: e.target.value })} maxLength={2000} />
        </Field>
      </div>

      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-3 pt-1">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || draft.prompt.trim() === ""}>
          {question ? "Save question" : "Add question"}
        </Button>
      </div>
    </form>
  );
}
