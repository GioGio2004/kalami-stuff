"use client";

import { useId, type ReactNode } from "react";
import { SmallIcon } from "@/components/lessons-editor/BlockForms";
import { CheckCard, Field, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/form";
import { ArrowDown, ArrowUp, Cross, Plus } from "@/components/ui/icons";
import {
  DECK_CODE_LANGUAGES,
  DECK_LIMITS,
  type CodeHighlight,
  type CompareSide,
  type DiagramNode,
  type Slide,
  type SlideOf,
  type SlideType,
} from "@/lib/presentation";

/**
 * The form for one slide, by type: plain fields for the words, nothing about
 * position, size or colour (the theme and the slide type decide those).
 */
export function SlideForm({ slide, onChange }: { slide: Slide; onChange: (slide: Slide) => void }) {
  switch (slide.type) {
    case "title":
      return <TitleForm slide={slide} onChange={onChange} />;
    case "section":
      return <SectionForm slide={slide} onChange={onChange} />;
    case "statement":
      return <StatementForm slide={slide} onChange={onChange} />;
    case "points":
      return <PointsForm slide={slide} onChange={onChange} />;
    case "number":
      return <NumberForm slide={slide} onChange={onChange} />;
    case "compare":
      return <CompareForm slide={slide} onChange={onChange} />;
    case "quote":
      return <QuoteForm slide={slide} onChange={onChange} />;
    case "code":
      return <CodeForm slide={slide} onChange={onChange} />;
    case "image":
      return <ImageForm slide={slide} onChange={onChange} />;
    case "diagram":
      return <DiagramForm slide={slide} onChange={onChange} />;
    case "closing":
      return <ClosingForm slide={slide} onChange={onChange} />;
  }
}

type FormProps<T extends SlideType> = { slide: SlideOf<T>; onChange: (slide: SlideOf<T>) => void };

const ACCENT_HINT = (
  <>
    Wrap a few key words in <code className="font-mono">**double asterisks**</code> for the theme&apos;s accent mark;{" "}
    <code className="font-mono">`backticks`</code> for code.
  </>
);

/** A one-line text field. `rich` adds the hint about accent marks. */
function Line({
  label,
  value,
  onChange,
  max,
  optional,
  placeholder,
  rich,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  max: number;
  optional?: boolean;
  placeholder?: string;
  rich?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} optional={optional} hint={rich ? ACCENT_HINT : undefined}>
      <TextInput id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={max * 2} placeholder={placeholder} />
    </Field>
  );
}

function Lines({
  label,
  value,
  onChange,
  max,
  rows = 3,
  optional,
  rich,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  max: number;
  rows?: number;
  optional?: boolean;
  rich?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} optional={optional} hint={rich ? ACCENT_HINT : undefined}>
      <TextArea
        id={id}
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max * 2}
        placeholder={placeholder}
        className="field-sizing-content"
      />
    </Field>
  );
}

/** A list of short texts: one field each, with add, remove and move. */
function TextList({
  label,
  items,
  onChange,
  max,
  min,
  limit,
  noun,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  max: number;
  min: number;
  limit: number;
  noun: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const set = (i: number, value: string) => onChange(items.map((item, j) => (j === i ? value : item)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  return (
    <Field label={label} hint={hint}>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-graphite">{i + 1}</span>
            <label htmlFor={`${id}-${i}`} className="sr-only">
              {`${noun} ${i + 1}`}
            </label>
            <TextInput id={`${id}-${i}`} value={item} onChange={(e) => set(i, e.target.value)} maxLength={max * 2} className="min-w-0 flex-1" />
            <SmallIcon label={`Move ${noun.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </SmallIcon>
            <SmallIcon label={`Move ${noun.toLowerCase()} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </SmallIcon>
            <SmallIcon label={`Remove ${noun.toLowerCase()} ${i + 1}`} disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Cross className="size-4" />
            </SmallIcon>
          </li>
        ))}
      </ol>
      {items.length < limit && (
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-graphite transition hover:bg-panel hover:text-ink"
        >
          <Plus className="size-4" />
          Add {noun.toLowerCase()}
        </button>
      )}
    </Field>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

// --- Types ----------------------------------------------------------------------------------

function TitleForm({ slide, onChange }: FormProps<"title">) {
  return (
    <div className="space-y-4">
      <Line label="Kicker" optional value={slide.kicker} onChange={(kicker) => onChange({ ...slide, kicker })} max={DECK_LIMITS.kicker} placeholder="Week 3 · CSS layout" />
      <Line label="Title" rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.headline} />
      <Lines label="Subtitle" optional rows={2} value={slide.subtitle} onChange={(subtitle) => onChange({ ...slide, subtitle })} max={DECK_LIMITS.subtitle} />
    </div>
  );
}

function SectionForm({ slide, onChange }: FormProps<"section">) {
  return (
    <Grid>
      <Line label="Section title" rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
      <Line label="Kicker" optional value={slide.kicker} onChange={(kicker) => onChange({ ...slide, kicker })} max={DECK_LIMITS.kicker} placeholder="Part two" />
    </Grid>
  );
}

function StatementForm({ slide, onChange }: FormProps<"statement">) {
  return (
    <div className="space-y-4">
      <Line label="Kicker" optional value={slide.kicker} onChange={(kicker) => onChange({ ...slide, kicker })} max={DECK_LIMITS.kicker} placeholder="The big idea" />
      <Lines label="Statement" rich rows={2} value={slide.text} onChange={(text) => onChange({ ...slide, text })} max={DECK_LIMITS.statement} />
    </div>
  );
}

function BuildToggle({ checked, onChange, what }: { checked: boolean; onChange: (checked: boolean) => void; what: string }) {
  return (
    <CheckCard checked={checked} onChange={onChange}>
      <span className="block text-sm font-medium">Reveal one {what} per click</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-graphite">
        For presenting live. Otherwise they arrive one after another on their own.
      </span>
    </CheckCard>
  );
}

function PointsForm({ slide, onChange }: FormProps<"points">) {
  return (
    <div className="space-y-4">
      <Line label="Heading" optional rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
      <TextList
        label="Points"
        noun="Point"
        items={slide.points}
        onChange={(points) => onChange({ ...slide, points })}
        max={DECK_LIMITS.point}
        min={2}
        limit={DECK_LIMITS.points}
        hint={ACCENT_HINT}
      />
      <BuildToggle what="point" checked={slide.build ?? false} onChange={(build) => onChange({ ...slide, build })} />
    </div>
  );
}

function NumberForm({ slide, onChange }: FormProps<"number">) {
  const id = useId();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_6rem_6rem]">
        <Field label="Number" htmlFor={`${id}-value`}>
          <TextInput
            id={`${id}-value`}
            type="number"
            inputMode="decimal"
            value={Number.isFinite(slide.value) ? slide.value : ""}
            onChange={(e) => onChange({ ...slide, value: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
        </Field>
        <Field label="Decimals" htmlFor={`${id}-decimals`}>
          <SelectInput id={`${id}-decimals`} value={slide.decimals ?? 0} onChange={(e) => onChange({ ...slide, decimals: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Line label="Before" optional value={slide.prefix} onChange={(prefix) => onChange({ ...slide, prefix })} max={DECK_LIMITS.affix} placeholder="$" />
        <Line label="After" optional value={slide.suffix} onChange={(suffix) => onChange({ ...slide, suffix })} max={DECK_LIMITS.affix} placeholder="%" />
      </div>
      <Line label="What it means" rich value={slide.label} onChange={(label) => onChange({ ...slide, label })} max={DECK_LIMITS.label} />
      <Lines label="Context or source" optional rows={2} value={slide.detail} onChange={(detail) => onChange({ ...slide, detail })} max={DECK_LIMITS.detail} />
    </div>
  );
}

function CompareForm({ slide, onChange }: FormProps<"compare">) {
  const side = (which: "left" | "right", value: CompareSide) => onChange({ ...slide, [which]: value });
  return (
    <div className="space-y-4">
      <Line label="Heading" optional rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
      <div className="grid gap-4 md:grid-cols-2">
        {(["left", "right"] as const).map((which) => (
          <div key={which} className="space-y-3 rounded-2xl bg-panel p-4">
            <Line
              label={which === "left" ? "Left side" : "Right side"}
              value={slide[which].title}
              onChange={(title) => side(which, { ...slide[which], title })}
              max={DECK_LIMITS.sideTitle}
              placeholder={which === "left" ? "Before" : "After"}
            />
            <TextList
              label="Points"
              noun="Point"
              items={slide[which].points}
              onChange={(points) => side(which, { ...slide[which], points })}
              max={DECK_LIMITS.sidePoint}
              min={1}
              limit={DECK_LIMITS.sidePoints}
            />
          </div>
        ))}
      </div>
      <Line label="Verdict" optional rich value={slide.verdict} onChange={(verdict) => onChange({ ...slide, verdict })} max={DECK_LIMITS.verdict} />
    </div>
  );
}

function QuoteForm({ slide, onChange }: FormProps<"quote">) {
  return (
    <div className="space-y-4">
      <Lines label="Quotation" rich rows={3} value={slide.quote} onChange={(quote) => onChange({ ...slide, quote })} max={DECK_LIMITS.quote} />
      <Grid>
        <Line label="Who said it" optional value={slide.author} onChange={(author) => onChange({ ...slide, author })} max={DECK_LIMITS.author} />
        <Line label="Who they are, or the source" optional value={slide.role} onChange={(role) => onChange({ ...slide, role })} max={DECK_LIMITS.role} />
      </Grid>
    </div>
  );
}

function CodeForm({ slide, onChange }: FormProps<"code">) {
  const id = useId();
  const highlights = slide.highlights ?? [];
  const lineCount = slide.code.split("\n").length;
  const setHighlight = (i: number, value: CodeHighlight) => onChange({ ...slide, highlights: highlights.map((h, j) => (j === i ? value : h)) });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Line label="Heading" optional rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
        <Field label="Language" htmlFor={`${id}-lang`}>
          <SelectInput id={`${id}-lang`} value={slide.language} onChange={(e) => onChange({ ...slide, language: e.target.value })}>
            {DECK_CODE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Code" htmlFor={`${id}-code`} hint={`Up to ${DECK_LIMITS.codeLines} lines: a slide shows a fragment. It types itself in.`}>
        <textarea
          id={`${id}-code`}
          value={slide.code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={6}
          maxLength={DECK_LIMITS.code}
          onChange={(e) => onChange({ ...slide, code: e.target.value })}
          className="field-sizing-content block min-h-32 w-full resize-y rounded-2xl border border-charcoal bg-charcoal px-4 py-3 font-mono text-[13.5px] leading-relaxed text-paper caret-highlighter outline-none transition focus:ring-4 focus:ring-highlighter/60"
        />
      </Field>
      <Field label="Walk through it" optional hint="Each Next highlights these lines and shows the note beside the code.">
        {highlights.length > 0 && (
          <ol className="space-y-2">
            {highlights.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-panel p-2">
                <span className="w-6 text-right font-mono text-xs text-graphite">{i + 1}</span>
                <label className="flex items-center gap-1.5 text-xs text-graphite">
                  Lines
                  <TextInput
                    type="number"
                    min={1}
                    max={lineCount}
                    value={h.from}
                    onChange={(e) => setHighlight(i, { ...h, from: Number(e.target.value) || 1 })}
                    className="w-16 py-1.5"
                    aria-label={`Highlight ${i + 1}: first line`}
                  />
                  to
                  <TextInput
                    type="number"
                    min={1}
                    max={lineCount}
                    value={h.to ?? h.from}
                    onChange={(e) => setHighlight(i, { ...h, to: Number(e.target.value) || h.from })}
                    className="w-16 py-1.5"
                    aria-label={`Highlight ${i + 1}: last line`}
                  />
                </label>
                <TextInput
                  value={h.note ?? ""}
                  onChange={(e) => setHighlight(i, { ...h, note: e.target.value })}
                  maxLength={DECK_LIMITS.highlightNote * 2}
                  placeholder="What to notice"
                  className="min-w-40 flex-1 py-1.5"
                  aria-label={`Highlight ${i + 1}: note`}
                />
                <SmallIcon label={`Remove highlight ${i + 1}`} onClick={() => onChange({ ...slide, highlights: highlights.filter((_, j) => j !== i) })}>
                  <Cross className="size-4" />
                </SmallIcon>
              </li>
            ))}
          </ol>
        )}
        {highlights.length < DECK_LIMITS.highlights && (
          <button
            type="button"
            onClick={() => onChange({ ...slide, highlights: [...highlights, { from: 1, to: Math.min(lineCount, 2), note: "" }] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-graphite transition hover:bg-panel hover:text-ink"
          >
            <Plus className="size-4" />
            Add a highlight
          </button>
        )}
      </Field>
    </div>
  );
}

function ImageForm({ slide, onChange }: FormProps<"image">) {
  return (
    <div className="space-y-4">
      <Line label="Picture link" value={slide.url} onChange={(url) => onChange({ ...slide, url: url.trim() })} max={DECK_LIMITS.url / 2} placeholder="https://…" />
      <Line label="What it shows (for screen readers)" value={slide.alt} onChange={(alt) => onChange({ ...slide, alt })} max={DECK_LIMITS.alt} />
      <Grid>
        <Line label="Heading" optional rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
        <Line label="Caption" optional value={slide.caption} onChange={(caption) => onChange({ ...slide, caption })} max={DECK_LIMITS.caption} />
      </Grid>
      <Field label="Layout">
        <Segmented
          label="Image layout"
          value={slide.layout ?? "split"}
          options={[
            { value: "split", label: "Beside the words" },
            { value: "full", label: "Fills the slide" },
          ]}
          onChange={(layout) => onChange({ ...slide, layout })}
        />
      </Field>
    </div>
  );
}

const LAYOUTS = [
  { value: "flow", label: "Flow" },
  { value: "cycle", label: "Cycle" },
  { value: "stack", label: "Stack" },
  { value: "hub", label: "Hub" },
] as const;

const LAYOUT_HINT: Record<SlideOf<"diagram">["layout"], string> = {
  flow: "Steps in order, left to right; arrows join each step to the next.",
  cycle: "A loop: the last node points back to the first.",
  stack: "Layers from top to bottom.",
  hub: "The first node sits in the middle; the others around it.",
};

function DiagramForm({ slide, onChange }: FormProps<"diagram">) {
  const nodes = slide.nodes;
  const setNode = (i: number, node: DiagramNode) => onChange({ ...slide, nodes: nodes.map((n, j) => (j === i ? node : n)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...nodes];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange({ ...slide, nodes: next });
  };
  const edgeLabel = (i: number) =>
    slide.layout === "hub" ? (i === 0 ? null : "Label on its spoke") : i === 0 ? (slide.layout === "cycle" ? "Label on the arrow back here" : null) : "Label on the arrow in";
  return (
    <div className="space-y-4">
      <Line label="Heading" optional rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
      <Field label="Layout" hint={LAYOUT_HINT[slide.layout]}>
        <Segmented label="Diagram layout" value={slide.layout} options={LAYOUTS} onChange={(layout) => onChange({ ...slide, layout })} />
      </Field>
      <Field label="Nodes" hint="Nobody places anything: the layout puts the nodes and draws the arrows.">
        <ol className="space-y-2">
          {nodes.map((node, i) => {
            const edge = edgeLabel(i);
            return (
              <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-panel p-2">
                <span className="w-6 text-right font-mono text-xs text-graphite">{i + 1}</span>
                <TextInput
                  value={node.label}
                  onChange={(e) => setNode(i, { ...node, label: e.target.value })}
                  maxLength={DECK_LIMITS.nodeLabel * 2}
                  placeholder="Label"
                  className="w-36 py-1.5"
                  aria-label={`Node ${i + 1}: label`}
                />
                <TextInput
                  value={node.detail ?? ""}
                  onChange={(e) => setNode(i, { ...node, detail: e.target.value })}
                  maxLength={DECK_LIMITS.nodeDetail * 2}
                  placeholder="A short line under it"
                  className="min-w-32 flex-1 py-1.5"
                  aria-label={`Node ${i + 1}: detail`}
                />
                {edge && (
                  <TextInput
                    value={node.edge ?? ""}
                    onChange={(e) => setNode(i, { ...node, edge: e.target.value })}
                    maxLength={DECK_LIMITS.edge * 2}
                    placeholder={edge}
                    className="w-40 py-1.5 font-mono text-xs"
                    aria-label={`Node ${i + 1}: ${edge.toLowerCase()}`}
                  />
                )}
                <span className="flex">
                  <SmallIcon label={`Move node ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </SmallIcon>
                  <SmallIcon label={`Move node ${i + 1} down`} disabled={i === nodes.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </SmallIcon>
                  <SmallIcon label={`Remove node ${i + 1}`} disabled={nodes.length <= 2} onClick={() => onChange({ ...slide, nodes: nodes.filter((_, j) => j !== i) })}>
                    <Cross className="size-4" />
                  </SmallIcon>
                </span>
              </li>
            );
          })}
        </ol>
        {nodes.length < DECK_LIMITS.nodes && (
          <button
            type="button"
            onClick={() => onChange({ ...slide, nodes: [...nodes, { label: "" }] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-graphite transition hover:bg-panel hover:text-ink"
          >
            <Plus className="size-4" />
            Add a node
          </button>
        )}
      </Field>
      <BuildToggle what="node" checked={slide.build ?? false} onChange={(build) => onChange({ ...slide, build })} />
    </div>
  );
}

function ClosingForm({ slide, onChange }: FormProps<"closing">) {
  return (
    <div className="space-y-4">
      <Line label="Title" rich value={slide.title} onChange={(title) => onChange({ ...slide, title })} max={DECK_LIMITS.slideTitle} />
      <TextList
        label="Recap"
        noun="Point"
        items={slide.points ?? []}
        onChange={(points) => onChange({ ...slide, points })}
        max={DECK_LIMITS.point}
        min={0}
        limit={DECK_LIMITS.closingPoints}
      />
      <Line label="What comes next" optional value={slide.next} onChange={(next) => onChange({ ...slide, next })} max={DECK_LIMITS.next} placeholder="Next week: Flexbox" />
    </div>
  );
}
