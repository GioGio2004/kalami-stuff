"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Markdown } from "@/components/sandbox/Markdown";
import { Preview } from "@/components/sandbox/Preview";
import { tokenize, type TokenKind } from "./highlight";
import { videoEmbedUrl, type CalloutTone, type LessonBlock, type LessonCheck } from "./types";

/**
 * One lesson block as students see it; LessonSlides shows a lesson with one
 * block per slide. The staff editor previews with the same components, so
 * lecturers see exactly what students get. Steps reveal one at a time; checks
 * answer on the spot. Text is Markdown rendered as React text, code is shown as
 * text with our own colouring (highlight.ts), and HTML/CSS previews run in the
 * same sandboxed iframe as code tasks (no scripts). Layouts follow the width
 * the block has, not the window's, so a block fits the editor's narrow preview
 * too. Type sizes are in em: the presenter mode scales a whole slide up by
 * raising the font size of its root.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "text":
      return <Markdown source={block.md} className="text-[1.0625em] leading-[1.75] text-ink" />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} md={block.md} />;
    case "code":
      return <CodeBlock language={block.language} code={block.code} caption={block.caption} preview={block.preview} />;
    case "image":
      return (
        <figure>
          {/* Lecturers' images come from anywhere; next/image would need every host allowed in advance. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.url}
            alt={block.alt}
            loading="lazy"
            className="max-h-[66dvh] w-full rounded-[1.6rem] bg-panel object-contain ring-1 ring-ink/10"
          />
          {block.caption && <Caption>{block.caption}</Caption>}
        </figure>
      );
    case "video":
      return <Video url={block.url} caption={block.caption} />;
    case "steps":
      return <Steps title={block.title} steps={block.steps} />;
    case "check":
      return <Check check={block.check} />;
  }
}

/** What kind of slide a block makes, for the slide's eyebrow. */
export function blockKindLabel(block: LessonBlock): string {
  switch (block.type) {
    case "text":
      return "Reading";
    case "callout":
      return TONE[block.tone].label;
    case "code":
      return block.preview ? "Example with result" : "Example";
    case "image":
      return "Figure";
    case "video":
      return "Video";
    case "steps":
      return "Step by step";
    case "check":
      return "Quick check";
  }
}

/** Blocks that read best at a prose width; the rest take the whole slide. */
export function blockIsProse(block: LessonBlock): boolean {
  return block.type === "text" || block.type === "callout" || block.type === "steps" || block.type === "check";
}

function Caption({ children }: { children: ReactNode }) {
  return <figcaption className="mt-3 text-center text-[0.9em] text-graphite">{children}</figcaption>;
}

// --- Callout ------------------------------------------------------------------------------

const TONE: Record<CalloutTone, { label: string; box: string; badge: string; icon: string }> = {
  tip: { label: "Tip", box: "bg-highlighter/35", badge: "bg-ink text-highlighter", icon: "✦" },
  definition: { label: "Definition", box: "bg-card ring-1 ring-ink/10", badge: "bg-highlighter text-ink", icon: "≡" },
  warning: { label: "Watch out", box: "bg-red-pen/10", badge: "bg-red-pen text-paper", icon: "!" },
  note: { label: "Note", box: "bg-panel", badge: "bg-charcoal text-paper", icon: "i" },
};

function Callout({ tone, title, md }: { tone: CalloutTone; title?: string; md: string }) {
  const style = TONE[tone];
  return (
    <aside className={`rounded-[1.6rem] px-6 py-5 sm:px-7 sm:py-6 ${style.box}`} aria-label={title ?? style.label}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-[0.85em] font-semibold ${style.badge}`}>
          {style.icon}
        </span>
        <span className="text-[0.72em] font-semibold uppercase tracking-[0.14em] text-graphite">{style.label}</span>
      </div>
      {title && <p className="mt-3 text-[1.25em] font-medium leading-snug tracking-tight">{title}</p>}
      <Markdown source={md} className="mt-2.5 text-[1em] leading-[1.7]" />
    </aside>
  );
}

// --- Code ---------------------------------------------------------------------------------

/** What a CSS example styles: a small page with the usual elements. */
const CSS_SAMPLE_BODY = `<h1>Heading</h1>
<p>A paragraph with <a href="#">a link</a> and <strong>bold text</strong>.</p>
<ul><li>First item</li><li>Second item</li></ul>
<button>Button</button>`;

const TOKEN_CLASS: Record<TokenKind, string> = {
  text: "text-code-text",
  tag: "text-code-tag",
  attr: "text-code-attr",
  string: "text-code-string",
  comment: "text-code-comment italic",
  keyword: "text-code-keyword",
  number: "text-code-number",
  property: "text-code-property",
  selector: "text-code-selector",
  value: "text-code-value",
  function: "text-code-function",
  punct: "text-code-punct",
};

/** The file name on the window bar: what the student would save this as. */
function fileNameFor(language: string): string {
  switch (language.trim().toLowerCase()) {
    case "html":
      return "index.html";
    case "css":
      return "style.css";
    case "js":
    case "javascript":
      return "script.js";
    case "ts":
    case "typescript":
      return "script.ts";
    case "json":
      return "data.json";
    case "python":
    case "py":
      return "main.py";
    default:
      return language.trim() === "" ? "code" : language.trim();
  }
}

/** The bar on top of a code or result window: three dots, a name, and anything on the right. */
function WindowBar({ tone, title, live, aside }: { tone: "dark" | "light"; title: string; live?: boolean; aside?: ReactNode }) {
  const dark = tone === "dark";
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${dark ? "border-b border-paper/10" : "border-b border-line bg-paper"}`}>
      <span aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className={`size-2.5 rounded-full ${dark ? "bg-paper/20" : "bg-ink/15"}`} />
        ))}
      </span>
      <span className={`font-mono text-[0.72em] tracking-[0.08em] ${dark ? "text-paper/60" : "text-graphite"}`}>{title}</span>
      {live && (
        <span className="inline-flex items-center gap-1.5 text-[0.72em] uppercase tracking-[0.12em] text-graphite">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
          live
        </span>
      )}
      {aside && <span className="ml-auto">{aside}</span>}
    </div>
  );
}

function CodeBlock({ language, code, caption, preview }: { language: string; code: string; caption?: string; preview?: boolean }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => tokenize(language, code), [language, code]);
  const files = useMemo(() => {
    if (!preview) return null;
    if (language === "html") return [{ name: "index.html", content: code }];
    return [
      { name: "index.html", content: `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>${CSS_SAMPLE_BODY}</body></html>` },
      { name: "style.css", content: code },
    ];
  }, [preview, language, code]);
  const gutter = String(lines.length).length;

  const copy = (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard refused; the code stays selectable.
        }
      }}
      className="rounded-full px-3 py-1 text-[0.78em] font-medium text-paper/70 ring-1 ring-paper/15 transition hover:bg-paper/10 hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );

  return (
    // Code and its result sit side by side once the block is wide enough, whatever the window.
    <figure className="@container min-w-0">
      <div className={files ? "grid gap-3 @2xl:grid-cols-2 @2xl:items-stretch" : ""}>
        <div className="flex min-w-0 flex-col overflow-hidden rounded-[1.4rem] bg-charcoal text-code-text shadow-[0_20px_50px_-30px_rgba(20,20,20,0.6)]">
          <WindowBar tone="dark" title={fileNameFor(language)} aside={copy} />
          <pre className="max-h-[60dvh] flex-1 overflow-auto py-3.5 font-mono text-[0.82em] leading-[1.75]">
            <code className="block min-w-max">
              {lines.map((line, n) => (
                <span key={n} className="flex">
                  <span aria-hidden="true" className="shrink-0 select-none pl-4 pr-4 text-right text-code-line" style={{ minWidth: `${gutter + 2.5}ch` }}>
                    {n + 1}
                  </span>
                  <span className="pr-6">
                    {line.map((token, t) => (
                      <span key={t} className={TOKEN_CLASS[token.kind]}>
                        {token.text}
                      </span>
                    ))}
                    {line.length === 0 && "​"}
                  </span>
                </span>
              ))}
            </code>
          </pre>
        </div>
        {files && (
          <div className="flex min-h-64 min-w-0 flex-col overflow-hidden rounded-[1.4rem] bg-white ring-1 ring-line">
            <WindowBar tone="light" title="Result" live />
            <div className="relative min-h-56 flex-1">
              <div className="absolute inset-0">
                <Preview files={files} assets={[]} />
              </div>
            </div>
          </div>
        )}
      </div>
      {caption && <Caption>{caption}</Caption>}
    </figure>
  );
}

// --- Video --------------------------------------------------------------------------------

function Video({ url, caption }: { url: string; caption?: string }) {
  const embed = videoEmbedUrl(url);
  return (
    <figure>
      {embed ? (
        <div className="relative aspect-video overflow-hidden rounded-[1.6rem] bg-charcoal shadow-[0_20px_50px_-30px_rgba(20,20,20,0.6)]">
          <iframe
            src={embed}
            title={caption ?? "Video"}
            loading="lazy"
            // `fullscreen` here is what allows it; the older allowFullScreen attribute would only add a console warning.
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        </div>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-[1.6rem] bg-panel px-5 py-4 font-medium hover:bg-panel-strong"
        >
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-ink text-paper">
            ▶
          </span>
          <span className="min-w-0 flex-1 truncate">{caption ?? "Watch the video"}</span>
          <span className="text-[0.9em] text-graphite">{hostOf(url)}</span>
        </a>
      )}
      {embed && caption && <Caption>{caption}</Caption>}
    </figure>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// --- Steps --------------------------------------------------------------------------------

function Steps({ title, steps }: { title?: string; steps: { title?: string; md: string }[] }) {
  const [shown, setShown] = useState(1);
  const reduce = useReducedMotion();
  const all = shown >= steps.length;
  return (
    <section className="rounded-[1.6rem] bg-card px-6 py-6 ring-1 ring-ink/10 sm:px-7">
      {title && <p className="text-[1.25em] font-medium leading-snug tracking-tight">{title}</p>}
      <ol className={title ? "mt-5 space-y-5" : "space-y-5"}>
        {steps.slice(0, shown).map((step, index) => (
          <motion.li
            key={index}
            initial={reduce || index === 0 ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="relative flex gap-4"
          >
            {/* The thread between the numbers. */}
            {index < shown - 1 && <span aria-hidden="true" className="absolute left-4 top-9 h-[calc(100%-0.75rem)] w-px bg-line" />}
            <span
              aria-hidden="true"
              className={`relative grid size-8 shrink-0 place-items-center rounded-full text-[0.85em] font-semibold ${
                index === shown - 1 && !all ? "bg-highlighter text-ink" : "bg-ink text-paper"
              }`}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              {step.title && <p className="font-medium">{step.title}</p>}
              <Markdown source={step.md} className={`text-[1em] leading-[1.7] ${step.title ? "mt-1" : ""}`} />
            </div>
          </motion.li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3 pl-12">
        {!all ? (
          <>
            <button
              type="button"
              onClick={() => setShown((n) => n + 1)}
              className="rounded-full bg-ink px-4 py-2 text-[0.9em] font-medium text-paper transition hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              Next step ({shown + 1}/{steps.length})
            </button>
            <button type="button" onClick={() => setShown(steps.length)} className="text-[0.9em] text-graphite underline-offset-4 hover:underline">
              Show all
            </button>
          </>
        ) : (
          steps.length > 1 && <span className="text-[0.9em] text-graphite">All {steps.length} steps shown.</span>
        )}
      </div>
    </section>
  );
}

// --- Check --------------------------------------------------------------------------------

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function Check({ check }: { check: LessonCheck }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<"right" | "wrong" | null>(null);
  const options = check.options ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    let right: boolean;
    if (check.kind === "short") {
      right = (check.accepted ?? []).some((a) => normalize(a) === normalize(typed));
    } else {
      const correct = options.flatMap((o, i) => (o.correct ? [i] : []));
      right = correct.length === picked.length && correct.every((i) => picked.includes(i));
    }
    setResult(right ? "right" : "wrong");
  }

  const answered = check.kind === "short" ? typed.trim() !== "" : picked.length > 0;

  return (
    <form onSubmit={submit} className="rounded-[1.6rem] bg-card px-6 py-6 ring-1 ring-ink/10 sm:px-7">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-highlighter text-[0.85em] font-semibold">
          ?
        </span>
        <span className="text-[0.72em] font-semibold uppercase tracking-[0.14em] text-graphite">Quick check</span>
      </div>
      <Markdown source={check.prompt} className="mt-3 text-[1.125em] font-medium leading-snug" />
      {check.kind === "short" ? (
        <input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setResult(null);
          }}
          aria-label="Your answer"
          className="mt-5 block w-full rounded-2xl border border-line bg-paper px-4 py-3 text-[0.95em] outline-none focus:border-ink focus:ring-4 focus:ring-highlighter/60"
          placeholder="Your answer"
        />
      ) : (
        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">{check.kind === "single" ? "Choose one" : "Choose all that apply"}</legend>
          {options.map((option, index) => {
            const on = picked.includes(index);
            const showRight = result !== null && option.correct;
            return (
              <label
                key={index}
                className={`flex cursor-pointer items-center gap-3.5 rounded-2xl border px-4 py-3.5 transition ${
                  showRight ? "border-ok bg-ok/10" : on ? "border-ink bg-panel" : "border-line bg-paper hover:border-ink/30"
                }`}
              >
                <input
                  type={check.kind === "single" ? "radio" : "checkbox"}
                  name="choice"
                  checked={on}
                  onChange={() => {
                    setResult(null);
                    setPicked((current) =>
                      check.kind === "single" ? [index] : on ? current.filter((i) => i !== index) : [...current, index],
                    );
                  }}
                  className="size-4 accent-ink"
                />
                <span className="text-[0.95em] leading-snug">{option.text}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!answered}
          className="rounded-full bg-ink px-5 py-2.5 text-[0.9em] font-medium text-paper transition hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
        >
          Check
        </button>
        <span role="status" aria-live="polite" className="text-[0.9em] font-medium">
          {result === "right" && <span className="text-ok">✓ Right!</span>}
          {result === "wrong" && <span className="text-red-pen">Not quite. Try again.</span>}
        </span>
      </div>
      {result !== null && check.explanation && (
        <div className="mt-4 rounded-2xl bg-panel px-4 py-3 text-[0.95em] leading-[1.7]">
          <Markdown source={check.explanation} />
        </div>
      )}
    </form>
  );
}
