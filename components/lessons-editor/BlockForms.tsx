"use client";

import { useRef, useState, type ReactNode } from "react";
import { videoEmbedUrl, type LessonBlock, type LessonBlockType, type LessonCheck } from "@/components/lessons/types";
import { Button } from "@/components/ui/buttons";
import { CheckCard, Field, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/form";
import {
  ArrowDown,
  ArrowUp,
  Bulb,
  Code,
  Cross,
  ImageIcon,
  ListChecks,
  Play,
  Plus,
  Question,
  TextLines,
} from "@/components/ui/icons";
import { CALLOUT_TONES, CODE_LANGUAGES, canPreview, isHttpsUrl } from "./draft";

type Of<T extends LessonBlockType> = Extract<LessonBlock, { type: T }>;
type FormProps<T extends LessonBlockType> = { block: Of<T>; uid: string; onChange: (block: Of<T>) => void };

/** The form for one block, by type. `uid` makes its field ids unique on the page. */
export function BlockForm({ block, uid, onChange }: { block: LessonBlock; uid: string; onChange: (block: LessonBlock) => void }) {
  switch (block.type) {
    case "text":
      return <TextForm block={block} uid={uid} onChange={onChange} />;
    case "callout":
      return <CalloutForm block={block} uid={uid} onChange={onChange} />;
    case "code":
      return <CodeForm block={block} uid={uid} onChange={onChange} />;
    case "image":
      return <ImageForm block={block} uid={uid} onChange={onChange} />;
    case "video":
      return <VideoForm block={block} uid={uid} onChange={onChange} />;
    case "steps":
      return <StepsForm block={block} uid={uid} onChange={onChange} />;
    case "check":
      return <CheckForm block={block} uid={uid} onChange={onChange} />;
  }
}

export function BlockIcon({ type, className = "size-4" }: { type: LessonBlockType; className?: string }) {
  switch (type) {
    case "text":
      return <TextLines className={className} />;
    case "callout":
      return <Bulb className={className} />;
    case "code":
      return <Code className={className} />;
    case "image":
      return <ImageIcon className={className} />;
    case "video":
      return <Play className={className} />;
    case "steps":
      return <ListChecks className={className} />;
    case "check":
      return <Question className={className} />;
  }
}

const MD_HINT = (
  <>
    Markdown: <code className="font-mono">**bold**</code>, <code className="font-mono">*italic*</code>,{" "}
    <code className="font-mono">`code`</code>, <code className="font-mono">[link](https://…)</code>,{" "}
    <code className="font-mono">- list</code>, <code className="font-mono">### heading</code>. A blank line starts a new
    paragraph.
  </>
);

/** Textareas grow with their text where the browser can (field-sizing), and can be dragged taller anywhere. */
const grow = "field-sizing-content";

function TextForm({ block, uid, onChange }: FormProps<"text">) {
  return (
    <Field label="Text" htmlFor={`${uid}-md`} hint={MD_HINT}>
      <TextArea
        id={`${uid}-md`}
        rows={5}
        value={block.md}
        onChange={(e) => onChange({ ...block, md: e.target.value })}
        maxLength={20_000}
        placeholder="Explain one idea. Why before how."
        className={`${grow} min-h-32`}
      />
    </Field>
  );
}

function CalloutForm({ block, uid, onChange }: FormProps<"callout">) {
  return (
    <div className="space-y-4">
      <Field label="Kind">
        <Segmented label="Callout kind" value={block.tone} options={CALLOUT_TONES} onChange={(tone) => onChange({ ...block, tone })} />
      </Field>
      <Field label={block.tone === "definition" ? "Term" : "Title"} htmlFor={`${uid}-title`} optional>
        <TextInput
          id={`${uid}-title`}
          value={block.title ?? ""}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          maxLength={120}
          placeholder={block.tone === "definition" ? "Selector" : block.tone === "warning" ? "Don't forget the semicolon" : ""}
        />
      </Field>
      <Field label="Text" htmlFor={`${uid}-md`} hint={MD_HINT}>
        <TextArea
          id={`${uid}-md`}
          rows={3}
          value={block.md}
          onChange={(e) => onChange({ ...block, md: e.target.value })}
          maxLength={5_000}
          className={`${grow} min-h-24`}
        />
      </Field>
    </div>
  );
}

function CodeForm({ block, uid, onChange }: FormProps<"code">) {
  const previewable = canPreview(block.language);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <Field label="Language" htmlFor={`${uid}-lang`}>
          <SelectInput id={`${uid}-lang`} value={block.language} onChange={(e) => onChange({ ...block, language: e.target.value })}>
            {CODE_LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Caption" htmlFor={`${uid}-caption`} optional>
          <TextInput
            id={`${uid}-caption`}
            value={block.caption ?? ""}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
            maxLength={300}
            placeholder="A link with a class"
          />
        </Field>
      </div>
      <Field
        label="Code"
        htmlFor={`${uid}-code`}
        hint="Tab indents by two spaces. To leave the box with the keyboard, press Esc, then Tab."
      >
        <CodeArea id={`${uid}-code`} value={block.code} onChange={(code) => onChange({ ...block, code })} />
      </Field>
      {previewable ? (
        <CheckCard checked={block.preview === true} onChange={(preview) => onChange({ ...block, preview })}>
          Show live preview
          <span className="mt-0.5 block text-sm font-normal text-graphite">
            {block.language === "css"
              ? "Students see the result next to the code: your CSS applied to a small sample page (a heading, a paragraph, a list and a button)."
              : "Students see the page running next to the code. Scripts don't run."}
          </span>
        </CheckCard>
      ) : (
        <p className="text-xs text-graphite">A live preview is available for HTML and CSS.</p>
      )}
    </div>
  );
}

/** A plain monospace textarea where Tab indents (Esc, then Tab, moves on). */
function CodeArea({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const leaving = useRef(false);
  return (
    <textarea
      id={id}
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      rows={8}
      maxLength={20_000}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        leaving.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          leaving.current = true;
          return;
        }
        if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || leaving.current) {
          return;
        }
        e.preventDefault();
        const el = e.currentTarget;
        el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
        onChange(el.value);
      }}
      className={`${grow} block min-h-44 w-full resize-y rounded-2xl border border-charcoal bg-charcoal px-4 py-3 font-mono text-[13.5px] leading-relaxed text-paper caret-highlighter outline-none transition placeholder:text-paper/40 focus:ring-4 focus:ring-highlighter/60`}
      placeholder={"<a class=\"button\" href=\"#\">Sign up</a>"}
    />
  );
}

function ImageForm({ block, uid, onChange }: FormProps<"image">) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-60">
          <Field
            label="Image link"
            htmlFor={`${uid}-url`}
            hint="The https:// address of the image itself (often ending in .png, .jpg or .svg)."
          >
            <TextInput
              id={`${uid}-url`}
              type="url"
              inputMode="url"
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder="https://"
              maxLength={2000}
            />
          </Field>
        </div>
        <Thumbnail url={block.url} />
      </div>
      <Field
        label="Description (alt text)"
        htmlFor={`${uid}-alt`}
        hint="Required. Screen readers read it to students who can't see the image, and it shows when the image doesn't load. Say what matters in it."
      >
        <TextInput
          id={`${uid}-alt`}
          value={block.alt}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
          maxLength={300}
          placeholder="The box model: content, padding, border and margin, from the inside out"
          required
          aria-required
        />
      </Field>
      <Field label="Caption" htmlFor={`${uid}-caption`} optional>
        <TextInput
          id={`${uid}-caption`}
          value={block.caption ?? ""}
          onChange={(e) => onChange({ ...block, caption: e.target.value })}
          maxLength={300}
        />
      </Field>
    </div>
  );
}

function Thumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const valid = isHttpsUrl(url);
  const src = url.trim();
  return (
    <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-panel sm:mt-7">
      {valid && failed !== src ? (
        // Lecturers' images come from anywhere; next/image would need every host allowed in advance.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setFailed(src)} className="size-full object-cover" />
      ) : (
        <span className="px-2 text-center text-xs leading-snug text-graphite">
          {valid ? "Couldn't load this image" : <ImageIcon className="mx-auto size-6" />}
        </span>
      )}
    </div>
  );
}

function VideoForm({ block, uid, onChange }: FormProps<"video">) {
  const embed = isHttpsUrl(block.url) ? videoEmbedUrl(block.url.trim()) : null;
  return (
    <div className="space-y-4">
      <Field
        label="Video link"
        htmlFor={`${uid}-url`}
        hint="YouTube and Vimeo play inside the lesson. Any other link shows as a button that opens the video."
      >
        <TextInput
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          placeholder="https://www.youtube.com/watch?v=…"
          maxLength={2000}
        />
      </Field>
      <Field label="Caption" htmlFor={`${uid}-caption`} optional>
        <TextInput
          id={`${uid}-caption`}
          value={block.caption ?? ""}
          onChange={(e) => onChange({ ...block, caption: e.target.value })}
          maxLength={300}
        />
      </Field>
      {embed ? (
        <div className="relative aspect-video max-w-md overflow-hidden rounded-2xl bg-charcoal">
          <iframe
            src={embed}
            title={block.caption || "Video preview"}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        </div>
      ) : (
        isHttpsUrl(block.url) && (
          <p className="rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">
            Not a YouTube or Vimeo link, so students get a button that opens it in a new tab.
          </p>
        )
      )}
    </div>
  );
}

function StepsForm({ block, uid, onChange }: FormProps<"steps">) {
  const steps = block.steps;
  const setStep = (index: number, patch: Partial<(typeof steps)[number]>) =>
    onChange({ ...block, steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  const move = (index: number, direction: -1 | 1) => {
    const next = [...steps];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange({ ...block, steps: next });
  };
  return (
    <div className="space-y-4">
      <Field label="Title" htmlFor={`${uid}-title`} optional>
        <TextInput
          id={`${uid}-title`}
          value={block.title ?? ""}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          maxLength={120}
          placeholder="Link a stylesheet"
        />
      </Field>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={index} className="rounded-2xl bg-panel/70 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-paper tabular-nums">
                {index + 1}
              </span>
              <span className="text-sm font-medium">Step {index + 1}</span>
              <span className="ml-auto flex">
                <SmallIcon label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="size-4" />
                </SmallIcon>
                <SmallIcon label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="size-4" />
                </SmallIcon>
                <SmallIcon
                  label={`Remove step ${index + 1}`}
                  disabled={steps.length <= 1}
                  onClick={() => onChange({ ...block, steps: steps.filter((_, i) => i !== index) })}
                >
                  <Cross className="size-4" />
                </SmallIcon>
              </span>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Step title" htmlFor={`${uid}-s${index}-title`} optional>
                <TextInput
                  id={`${uid}-s${index}-title`}
                  value={step.title ?? ""}
                  onChange={(e) => setStep(index, { title: e.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label="What to do" htmlFor={`${uid}-s${index}-md`}>
                <TextArea
                  id={`${uid}-s${index}-md`}
                  rows={2}
                  value={step.md}
                  onChange={(e) => setStep(index, { md: e.target.value })}
                  maxLength={3_000}
                  className={`${grow} min-h-20`}
                />
              </Field>
            </div>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        variant="outline"
        disabled={steps.length >= 20}
        onClick={() => onChange({ ...block, steps: [...steps, { md: "" }] })}
      >
        <Plus className="size-4" />
        Add step
      </Button>
    </div>
  );
}

const CHECK_KINDS: { value: LessonCheck["kind"]; label: string }[] = [
  { value: "single", label: "One answer" },
  { value: "multiple", label: "Several answers" },
  { value: "short", label: "Typed answer" },
];

function CheckForm({ block, uid, onChange }: FormProps<"check">) {
  const { check } = block;
  const options = check.options ?? [];
  const accepted = check.accepted ?? [];
  const set = (patch: Partial<LessonCheck>) => onChange({ ...block, check: { ...check, ...patch } });

  function switchKind(kind: LessonCheck["kind"]) {
    if (kind === "short") {
      set({ kind, accepted: accepted.length > 0 ? accepted : [""] });
      return;
    }
    let next = options.length >= 2 ? options : [...options, ...Array.from({ length: 2 - options.length }, () => ({ text: "", correct: false }))];
    if (kind === "single" && next.filter((o) => o.correct).length !== 1) {
      const first = Math.max(0, next.findIndex((o) => o.correct));
      next = next.map((o, i) => ({ ...o, correct: i === first }));
    }
    set({ kind, options: next });
  }

  return (
    <div className="space-y-4">
      <Field label="Answer">
        <Segmented label="Answer kind" value={check.kind} options={CHECK_KINDS} onChange={switchKind} />
      </Field>
      <Field label="Question" htmlFor={`${uid}-prompt`} hint="Markdown works here too.">
        <TextArea
          id={`${uid}-prompt`}
          rows={2}
          value={check.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          maxLength={2_000}
          placeholder="Which selector matches every <p> inside an <article>?"
          className={`${grow} min-h-20`}
        />
      </Field>
      {check.kind === "short" ? (
        <fieldset>
          <legend className="text-sm font-medium">Accepted answers</legend>
          <p className="mt-1 text-xs text-graphite">Any of these counts as right. Capitals and extra spaces don&apos;t matter.</p>
          <ul className="mt-2 space-y-2">
            {accepted.map((answer, index) => (
              <li key={index} className="flex items-center gap-2">
                <TextInput
                  aria-label={`Accepted answer ${index + 1}`}
                  value={answer}
                  onChange={(e) => set({ accepted: accepted.map((a, i) => (i === index ? e.target.value : a)) })}
                  maxLength={200}
                />
                <SmallIcon
                  label={`Remove accepted answer ${index + 1}`}
                  disabled={accepted.length <= 1}
                  onClick={() => set({ accepted: accepted.filter((_, i) => i !== index) })}
                >
                  <Cross className="size-4" />
                </SmallIcon>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={accepted.length >= 20}
            onClick={() => set({ accepted: [...accepted, ""] })}
          >
            <Plus className="size-4" />
            Add answer
          </Button>
        </fieldset>
      ) : (
        <fieldset>
          <legend className="text-sm font-medium">Options</legend>
          <p className="mt-1 text-xs text-graphite">
            {check.kind === "single" ? "Choose the one right answer with the circle." : "Tick every right answer."} 2 to 8
            options.
          </p>
          <ul className="mt-2 space-y-2">
            {options.map((option, index) => (
              <li key={index} className="flex items-center gap-2">
                <label
                  className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-2xl border transition has-focus-visible:ring-4 has-focus-visible:ring-highlighter/70 ${
                    option.correct ? "border-ink bg-highlighter/50" : "border-line bg-card hover:border-ink/30"
                  }`}
                >
                  <input
                    type={check.kind === "single" ? "radio" : "checkbox"}
                    name={`${uid}-correct`}
                    checked={option.correct}
                    onChange={() =>
                      set({
                        options: options.map((o, i) =>
                          check.kind === "single" ? { ...o, correct: i === index } : i === index ? { ...o, correct: !o.correct } : o,
                        ),
                      })
                    }
                    className="size-4 accent-ink"
                  />
                  <span className="sr-only">Option {index + 1} is right</span>
                </label>
                <TextInput
                  aria-label={`Option ${index + 1}`}
                  value={option.text}
                  onChange={(e) => set({ options: options.map((o, i) => (i === index ? { ...o, text: e.target.value } : o)) })}
                  maxLength={300}
                />
                <SmallIcon
                  label={`Remove option ${index + 1}`}
                  disabled={options.length <= 2}
                  onClick={() => set({ options: options.filter((_, i) => i !== index) })}
                >
                  <Cross className="size-4" />
                </SmallIcon>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={options.length >= 8}
            onClick={() => set({ options: [...options, { text: "", correct: false }] })}
          >
            <Plus className="size-4" />
            Add option
          </Button>
        </fieldset>
      )}
      <Field label="Explanation" htmlFor={`${uid}-explanation`} optional hint="Shown once they check, right or wrong.">
        <TextArea
          id={`${uid}-explanation`}
          rows={2}
          value={check.explanation ?? ""}
          onChange={(e) => set({ explanation: e.target.value })}
          maxLength={2_000}
          className={`${grow} min-h-20`}
        />
      </Field>
    </div>
  );
}

export function SmallIcon({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-full text-graphite transition hover:bg-panel hover:text-ink disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {children}
    </button>
  );
}
