"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import { Markdown } from "@/components/sandbox/Markdown";
import { Preview } from "@/components/sandbox/Preview";
import { videoEmbedUrl, type CalloutTone, type LessonBlock, type LessonCheck } from "./types";

/**
 * One lesson block as students see it; LessonSlides shows a lesson with one
 * block per slide. The staff editor previews with the same components, so
 * lecturers see exactly what students get. Steps reveal one at a time; checks
 * answer on the spot. Text is Markdown rendered as React text, code is shown as
 * text, and HTML/CSS previews run in the same sandboxed iframe as code tasks (no
 * scripts). Layouts follow the width the block has, not the window's, so a
 * block fits the editor's narrow preview too.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "text":
      return <Markdown source={block.md} className="text-[17px] leading-relaxed text-ink" />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} md={block.md} />;
    case "code":
      return <CodeBlock language={block.language} code={block.code} caption={block.caption} preview={block.preview} />;
    case "image":
      return (
        <figure>
          {/* Lecturers' images come from anywhere; next/image would need every host allowed in advance. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} loading="lazy" className="max-h-[70dvh] w-full rounded-3xl bg-panel object-contain" />
          {block.caption && <figcaption className="mt-2 text-center text-sm text-graphite">{block.caption}</figcaption>}
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

// --- Callout ------------------------------------------------------------------------------

const TONE: Record<CalloutTone, { label: string; box: string; badge: string; icon: string }> = {
  tip: { label: "Tip", box: "bg-highlighter/35", badge: "bg-ink text-highlighter", icon: "✦" },
  definition: { label: "Definition", box: "bg-card border border-ink/10", badge: "bg-highlighter text-ink", icon: "≡" },
  warning: { label: "Watch out", box: "bg-red-pen/10", badge: "bg-red-pen text-paper", icon: "!" },
  note: { label: "Note", box: "bg-panel", badge: "bg-charcoal text-paper", icon: "i" },
};

function Callout({ tone, title, md }: { tone: CalloutTone; title?: string; md: string }) {
  const style = TONE[tone];
  return (
    <aside className={`rounded-3xl px-5 py-4 sm:px-6 sm:py-5 ${style.box}`} aria-label={title ?? style.label}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${style.badge}`}>
          {style.icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-graphite">{style.label}</span>
      </div>
      {title && <p className="mt-2 text-lg font-medium tracking-tight">{title}</p>}
      <Markdown source={md} className="mt-2 text-[16px] leading-relaxed" />
    </aside>
  );
}

// --- Code ---------------------------------------------------------------------------------

/** What a CSS example styles: a small page with the usual elements. */
const CSS_SAMPLE_BODY = `<h1>Heading</h1>
<p>A paragraph with <a href="#">a link</a> and <strong>bold text</strong>.</p>
<ul><li>First item</li><li>Second item</li></ul>
<button>Button</button>`;

function CodeBlock({ language, code, caption, preview }: { language: string; code: string; caption?: string; preview?: boolean }) {
  const [copied, setCopied] = useState(false);
  const files = useMemo(() => {
    if (!preview) return null;
    if (language === "html") return [{ name: "index.html", content: code }];
    return [
      { name: "index.html", content: `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>${CSS_SAMPLE_BODY}</body></html>` },
      { name: "style.css", content: code },
    ];
  }, [preview, language, code]);

  return (
    // Code and its output sit side by side once the block is wide enough, whatever the window.
    <figure className="@container min-w-0">
      <div className={files ? "grid overflow-hidden rounded-3xl bg-charcoal @2xl:grid-cols-2" : "overflow-hidden rounded-3xl bg-charcoal"}>
        <div className="min-w-0">
          <div className="flex items-center justify-between px-4 pt-3 text-xs">
            <span className="font-mono uppercase tracking-[0.14em] text-paper/55">{language}</span>
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
              className="rounded-full px-2.5 py-1 text-paper/70 transition hover:bg-paper/10 hover:text-paper"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto px-4 pb-4 pt-2 font-mono text-[13.5px] leading-relaxed text-paper">
            <code>{code}</code>
          </pre>
        </div>
        {files && (
          <div className="min-h-56 border-t border-paper/10 bg-white @2xl:border-l @2xl:border-t-0">
            <Preview files={files} assets={[]} />
          </div>
        )}
      </div>
      {caption && <figcaption className="mt-2 text-center text-sm text-graphite">{caption}</figcaption>}
    </figure>
  );
}

// --- Video --------------------------------------------------------------------------------

function Video({ url, caption }: { url: string; caption?: string }) {
  const embed = videoEmbedUrl(url);
  return (
    <figure>
      {embed ? (
        <div className="relative aspect-video overflow-hidden rounded-3xl bg-charcoal">
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
          className="flex items-center gap-3 rounded-3xl bg-panel px-5 py-4 font-medium hover:bg-panel-strong"
        >
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-ink text-paper">
            ▶
          </span>
          <span className="min-w-0 flex-1 truncate">{caption ?? "Watch the video"}</span>
          <span className="text-sm text-graphite">{hostOf(url)}</span>
        </a>
      )}
      {embed && caption && <figcaption className="mt-2 text-center text-sm text-graphite">{caption}</figcaption>}
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
    <section className="rounded-3xl bg-card px-5 py-5 ring-1 ring-ink/10 sm:px-6">
      {title && <p className="text-lg font-medium tracking-tight">{title}</p>}
      <ol className={title ? "mt-4 space-y-4" : "space-y-4"}>
        {steps.slice(0, shown).map((step, index) => (
          <motion.li
            key={index}
            initial={reduce || index === 0 ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="flex gap-3.5"
          >
            <span
              aria-hidden="true"
              className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                index === shown - 1 && !all ? "bg-highlighter text-ink" : "bg-ink text-paper"
              }`}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              {step.title && <p className="font-medium">{step.title}</p>}
              <Markdown source={step.md} className={`text-[16px] leading-relaxed ${step.title ? "mt-1" : ""}`} />
            </div>
          </motion.li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3 pl-[2.875rem]">
        {!all ? (
          <>
            <button
              type="button"
              onClick={() => setShown((n) => n + 1)}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85"
            >
              Next step ({shown + 1}/{steps.length})
            </button>
            <button type="button" onClick={() => setShown(steps.length)} className="text-sm text-graphite underline-offset-4 hover:underline">
              Show all
            </button>
          </>
        ) : (
          steps.length > 1 && <span className="text-sm text-graphite">All {steps.length} steps shown.</span>
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
    <form onSubmit={submit} className="rounded-3xl border-2 border-dashed border-ink/15 px-5 py-5 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-graphite">Quick check</p>
      <Markdown source={check.prompt} className="mt-2 text-[17px] font-medium leading-relaxed" />
      {check.kind === "short" ? (
        <input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setResult(null);
          }}
          aria-label="Your answer"
          className="mt-4 block w-full rounded-2xl border border-line bg-card px-4 py-3 text-[15px] outline-none focus:border-ink focus:ring-4 focus:ring-highlighter/60"
          placeholder="Your answer"
        />
      ) : (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">{check.kind === "single" ? "Choose one" : "Choose all that apply"}</legend>
          {options.map((option, index) => {
            const on = picked.includes(index);
            const showRight = result !== null && option.correct;
            return (
              <label
                key={index}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                  showRight
                    ? "border-ok bg-ok/10"
                    : on
                      ? "border-ink bg-panel"
                      : "border-line bg-card hover:border-ink/30"
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
                <span className="text-[15px]">{option.text}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!answered}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40"
        >
          Check
        </button>
        <span role="status" aria-live="polite" className="text-sm font-medium">
          {result === "right" && <span className="text-ok">✓ Right!</span>}
          {result === "wrong" && <span className="text-red-pen">Not quite. Try again.</span>}
        </span>
      </div>
      {result !== null && check.explanation && (
        <div className="mt-3 rounded-2xl bg-panel px-4 py-3 text-[15px] leading-relaxed">
          <Markdown source={check.explanation} />
        </div>
      )}
    </form>
  );
}
