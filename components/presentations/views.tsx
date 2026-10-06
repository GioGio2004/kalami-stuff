"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { fileNameFor, TOKEN_CLASS } from "@/components/lessons/codeWindow";
import { tokenize } from "@/components/lessons/highlight";
import {
  diagramEdges,
  parseRich,
  plainText,
  slideTone,
  type DeckTheme,
  type Slide,
  type SlideOf,
} from "@/lib/presentation";
import s from "./deck.module.css";
import { layoutDiagram } from "./diagram";
import { formatNumber, pad } from "./format";
import { THEMES } from "./themes";

/**
 * Every slide type's layout, in its final state: what a slide looks like once
 * its animation has played. The choreography (choreo.ts) finds the parts it
 * animates by `data-k`; thumbnails and the overview show these as they are.
 * Sizes are in the stage's container units, so the same markup serves the
 * full screen and a thumbnail. Long text gets a smaller size (fit), so a slide
 * never overflows however much the lecturer wrote within the limits.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function SlideView({ slide, theme, sectionNumber }: { slide: Slide; theme: DeckTheme; sectionNumber?: number }) {
  const tone = slideTone(slide);
  const look = THEMES[theme].mark;
  // A marker on an accent fill would vanish; accent slides underline instead.
  const mark = tone === "accent" && look === "marker" ? "scribble" : look;
  return (
    <div className={s.slide} data-type={slide.type} data-tone={tone} data-mark={mark}>
      <Body slide={slide} sectionNumber={sectionNumber ?? 1} />
    </div>
  );
}

function Body({ slide, sectionNumber }: { slide: Slide; sectionNumber: number }) {
  switch (slide.type) {
    case "title":
      return <TitleSlide slide={slide} />;
    case "section":
      return <SectionSlide slide={slide} number={sectionNumber} />;
    case "statement":
      return <StatementSlide slide={slide} />;
    case "points":
      return <PointsSlide slide={slide} />;
    case "number":
      return <NumberSlide slide={slide} />;
    case "compare":
      return <CompareSlide slide={slide} />;
    case "quote":
      return <QuoteSlide slide={slide} />;
    case "code":
      return <CodeSlide slide={slide} />;
    case "image":
      return <ImageSlide slide={slide} />;
    case "diagram":
      return <DiagramSlide slide={slide} />;
    case "closing":
      return <ClosingSlide slide={slide} />;
  }
}

// --- Pieces ------------------------------------------------------------------------------

/** Slide text: **accent** words get the theme's mark, `code` a code chip. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((segment, i) => {
        if (segment.kind === "accent") {
          return (
            <span key={i} data-accent="" className={s.mark} style={segment.text.length <= 28 ? { whiteSpace: "nowrap" } : undefined}>
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "code") {
          return (
            <code key={i} className={s.code}>
              {segment.text}
            </code>
          );
        }
        return <Fragment key={i}>{segment.text}</Fragment>;
      })}
    </>
  );
}

function Kicker({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p data-k="kicker" className={`${s.kicker} ${className}`}>
      <span aria-hidden="true" className={s.kickerDot} />
      <span data-k="kickerText">{text}</span>
    </p>
  );
}

/** A size for text of this length: the first step whose length it fits, else the last size. */
function fit(text: string, steps: [number, number][], last: number): CSSProperties {
  const length = plainText(text).length;
  const size = steps.find(([max]) => length <= max)?.[1] ?? last;
  return { "--fs": `${size}cqmin` } as CSSProperties;
}

const fs = (size: number): CSSProperties => ({ "--fs": `${size}cqmin` }) as CSSProperties;

function Heading({ text, className = "" }: { text: string; className?: string }) {
  return (
    <h2 data-k="title" className={`${s.display} ${s.heading} max-w-[26ch] ${className}`} style={fit(text, [[40, 5.6], [70, 4.8]], 4.2)}>
      <Rich text={text} />
    </h2>
  );
}

// --- Title --------------------------------------------------------------------------------

function TitleSlide({ slide }: { slide: SlideOf<"title"> }) {
  return (
    <>
      <div data-k="orb" aria-hidden="true" className={s.orb} />
      <div className="relative flex min-h-0 flex-1 flex-col justify-end">
        {slide.kicker && <Kicker text={slide.kicker} />}
        <h2
          data-k="title"
          className={`${s.display} ${s.titleXL} mt-[3.4cqmin] max-w-[14ch]`}
          style={fit(slide.title, [[16, 14], [30, 12.2], [56, 9.8], [84, 8.2]], 7)}
        >
          <Rich text={slide.title} />
        </h2>
        {slide.subtitle && (
          <p data-k="subtitle" className={`${s.body} ${s.muted} mt-[4.6cqmin] max-w-[46ch]`} style={fs(3.4)}>
            <Rich text={slide.subtitle} />
          </p>
        )}
      </div>
    </>
  );
}

// --- Section ------------------------------------------------------------------------------

function SectionSlide({ slide, number }: { slide: SlideOf<"section">; number: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between">
      <p data-k="number" aria-hidden="true" className={s.sectionNumber}>
        {pad(number)}
      </p>
      <div>
        <span data-k="rule" aria-hidden="true" className={s.rule} />
        {slide.kicker && <Kicker text={slide.kicker} className="mt-[3.2cqmin]" />}
        {/* Outside the heading: the heading's text gets split into lines for its animation. */}
        <span className="sr-only">Section {number}</span>
        <h2
          data-k="title"
          className={`${s.display} ${s.titleL} mt-[2.6cqmin] max-w-[18ch]`}
          style={fit(slide.title, [[16, 9.6], [32, 8], [60, 6.6]], 5.6)}
        >
          <Rich text={slide.title} />
        </h2>
      </div>
    </div>
  );
}

// --- Statement ----------------------------------------------------------------------------

function StatementSlide({ slide }: { slide: SlideOf<"statement"> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      {slide.kicker && <Kicker text={slide.kicker} className="mb-[4.4cqmin]" />}
      <p
        data-k="statement"
        className={`${s.display} ${s.titleL} max-w-[20ch]`}
        style={fit(slide.text, [[36, 11.2], [72, 9.4], [110, 7.6], [150, 6.4]], 5.6)}
      >
        <Rich text={slide.text} />
      </p>
    </div>
  );
}

// --- Points -------------------------------------------------------------------------------

function PointsSlide({ slide }: { slide: SlideOf<"points"> }) {
  const n = slide.points.length;
  const longest = Math.max(...slide.points.map((point) => plainText(point).length));
  const size = n <= 3 ? (longest > 90 ? 3.5 : 4.1) : n === 4 ? (longest > 90 ? 3.1 : 3.5) : longest > 80 ? 2.6 : 2.95;
  return (
    <>
      {slide.title && <Heading text={slide.title} />}
      <ol className={`${s.points} min-h-0 flex-1 justify-center ${slide.title ? "mt-[3.4cqmin]" : ""}`} style={fs(size)}>
        {slide.points.map((point, i) => (
          <li key={i} data-k="point" className={s.point}>
            <span data-k="pointRule" aria-hidden="true" className={s.pointRule} />
            <span data-k="pointNum" aria-hidden="true" className={s.pointNum}>
              {pad(i + 1)}
            </span>
            <span data-k="pointText" className={s.body}>
              <Rich text={point} />
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

// --- Number -------------------------------------------------------------------------------

function NumberSlide({ slide }: { slide: SlideOf<"number"> }) {
  const decimals = slide.decimals ?? 0;
  const text = formatNumber(slide.value, decimals);
  const length = text.length + (slide.prefix?.length ?? 0) * 0.5 + (slide.suffix?.length ?? 0) * 0.5;
  const size = length <= 3 ? 30 : length <= 5 ? 25 : length <= 8 ? 19 : 14;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <p data-k="number" className={s.bigNumber} style={fs(size)}>
        {slide.prefix && <span className={s.affix}>{slide.prefix}</span>}
        <span data-k="count" data-value={slide.value} data-decimals={decimals}>
          {text}
        </span>
        {slide.suffix && <span className={s.affix}>{slide.suffix}</span>}
      </p>
      <p data-k="label" className={`${s.display} ${s.heading} mt-[3.4cqmin] max-w-[24ch]`} style={fit(slide.label, [[40, 5.2], [80, 4.4]], 3.8)}>
        <Rich text={slide.label} />
      </p>
      {slide.detail && (
        <p data-k="detail" className={`${s.small} mt-[2.4cqmin] max-w-[62ch]`}>
          {slide.detail}
        </p>
      )}
    </div>
  );
}

// --- Compare ------------------------------------------------------------------------------

function CompareSlide({ slide }: { slide: SlideOf<"compare"> }) {
  const most = Math.max(slide.left.points.length, slide.right.points.length);
  const size = most <= 2 ? 3.2 : most <= 3 ? 2.9 : 2.5;
  return (
    <>
      {slide.title && <Heading text={slide.title} />}
      <div className={`${s.compare} ${slide.title ? "" : "mt-0"}`}>
        {(["left", "right"] as const).map((side, i) => (
          <Fragment key={side}>
            {i === 1 && (
              <div data-k="vs" aria-hidden="true" className={s.vs}>
                vs
              </div>
            )}
            <section data-k="side" data-side={side} className={s.side}>
              <h3 data-k="sideTitle" className={s.sideTitle}>
                {slide[side].title}
              </h3>
              <ul className={s.sidePoints}>
                {slide[side].points.map((point, j) => (
                  <li key={j} data-k="sidePoint" className={s.sidePoint}>
                    <span aria-hidden="true" className={s.bullet} />
                    <span className={s.body} style={fs(size)}>
                      <Rich text={point} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </Fragment>
        ))}
      </div>
      {slide.verdict && (
        <p data-k="verdict" className={s.verdict}>
          <span data-k="verdictBar" aria-hidden="true" className={s.verdictBar} />
          <span data-k="verdictText" className={s.body} style={fs(3.3)}>
            <Rich text={slide.verdict} />
          </span>
        </p>
      )}
    </>
  );
}

// --- Quote --------------------------------------------------------------------------------

function QuoteSlide({ slide }: { slide: SlideOf<"quote"> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <span data-k="glyph" aria-hidden="true" className={s.quoteGlyph}>
        “
      </span>
      <blockquote
        data-k="quote"
        className={`${s.quote} max-w-[30ch]`}
        style={fit(slide.quote, [[40, 8.8], [90, 6.9], [160, 5.5], [240, 4.6]], 4)}
      >
        <Rich text={slide.quote} />
      </blockquote>
      {(slide.author || slide.role) && (
        <p data-k="author" className={s.author}>
          <span data-k="authorRule" aria-hidden="true" className={s.authorRule} />
          {slide.author && <span>{slide.author}</span>}
          {slide.role && <span className={`${s.muted} font-normal`}>{slide.role}</span>}
        </p>
      )}
    </div>
  );
}

// --- Code ---------------------------------------------------------------------------------

function CodeSlide({ slide }: { slide: SlideOf<"code"> }) {
  const lines = useMemo(() => tokenize(slide.language, slide.code), [slide.language, slide.code]);
  const highlights = slide.highlights ?? [];
  const notes = highlights.length > 0;
  // The window fits every line: smaller type for longer code, never bigger than reads well.
  const fontSize = `min(2.9cqmin, calc(${slide.title ? 60 : 70}cqh / ${(lines.length * 1.62 + 2.4).toFixed(2)}))`;
  return (
    <>
      {slide.title && <Heading text={slide.title} />}
      <div className={`${s.codeWrap} ${slide.title ? "" : "mt-0"}`} data-notes={notes ? "true" : "false"}>
        <div data-k="window" className={s.codeWindow}>
          <div className={s.codeBar}>
            <span aria-hidden="true" className={s.codeDots}>
              <span />
              <span />
              <span />
            </span>
            <span>{fileNameFor(slide.language)}</span>
          </div>
          <div data-k="codeBody" className={s.codeBody} style={{ fontSize }}>
            <div data-k="band" aria-hidden="true" className={s.band} />
            {lines.map((line, n) => (
              <div key={n} data-k="line" className={s.codeLine}>
                <span data-k="gutter" aria-hidden="true" className={s.gutter}>
                  {n + 1}
                </span>
                <span data-k="lineText">
                  {line.map((token, t) => (
                    <span key={t} className={TOKEN_CLASS[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                  {line.length === 0 && "​"}
                </span>
              </div>
            ))}
          </div>
        </div>
        {notes && (
          <div data-k="notes" className={s.codeNotes}>
            {highlights.map((h, i) => (
              <div key={i} data-k="note" className={s.codeNote}>
                <p className={s.kicker}>
                  <span aria-hidden="true" className={s.kickerDot} />
                  {h.to !== undefined && h.to !== h.from ? `Lines ${h.from}–${h.to}` : `Line ${h.from}`}
                </p>
                {h.note && (
                  <p className={s.body} style={fs(3.1)}>
                    {h.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// --- Image --------------------------------------------------------------------------------

function ImageSlide({ slide }: { slide: SlideOf<"image"> }) {
  const full = slide.layout === "full" || (!slide.title && !slide.caption);
  const picture = (
    <div data-k="kb" className={s.kb}>
      {/* Lecturers' images come from anywhere; next/image would need every host allowed in advance. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-k="img" src={slide.url} alt={slide.alt} draggable={false} />
    </div>
  );
  if (full) {
    return (
      <>
        <figure data-k="frame" data-full="true" className={s.imageFull}>
          {picture}
          {(slide.title || slide.caption) && <div data-k="scrim" aria-hidden="true" className={s.scrim} />}
        </figure>
        {(slide.title || slide.caption) && (
          <div className={s.fullText}>
            {slide.title && <Heading text={slide.title} />}
            {slide.caption && (
              <p data-k="caption" className={`${s.small} mt-[2cqmin] max-w-[60ch]`}>
                {slide.caption}
              </p>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <div className={s.imageSplit}>
      <div className="flex min-h-0 flex-col justify-end">
        {slide.title && <Heading text={slide.title} />}
        {slide.caption && (
          <p data-k="caption" className={`${s.small} mt-[2.4cqmin]`}>
            {slide.caption}
          </p>
        )}
      </div>
      <figure data-k="frame" className={s.imageFrame}>
        {picture}
      </figure>
    </div>
  );
}

// --- Diagram ------------------------------------------------------------------------------

function DiagramSlide({ slide }: { slide: SlideOf<"diagram"> }) {
  const area = useRef<HTMLDivElement>(null);
  const edges = diagramEdges(slide.layout, slide.nodes);
  const n = slide.nodes.length;
  const nodeSize = n <= 3 ? 3.6 : n <= 5 ? 3.1 : 2.6;

  // Laid out by measuring, on mount, on resize and once fonts have loaded (labels change size).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const run = () => layoutDiagram(el);
    run();
    const observer = new ResizeObserver(run);
    observer.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => alive && run()).catch(() => undefined);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [slide]);

  const said = edges
    .map((edge) => `${slide.nodes[edge.from].label} → ${slide.nodes[edge.to].label}${edge.label ? ` (${edge.label})` : ""}`)
    .join("; ");

  return (
    <>
      {slide.title && <Heading text={slide.title} />}
      <div
        ref={area}
        data-k="diagram"
        data-layout={slide.layout}
        className={`${s.diagram} ${slide.title ? "" : "mt-0"}`}
        style={{ "--node-fs": `${nodeSize}cqmin` } as CSSProperties}
      >
        <svg aria-hidden="true" className={s.edges}>
          {edges.map((edge, i) => (
            <g key={i} data-edge={i} data-from={edge.from} data-to={edge.to}>
              <path data-k="edgeLine" className={s.edgeLine} />
              <path data-k="edgeHead" className={s.edgeHead} />
            </g>
          ))}
        </svg>
        {edges.map((edge, i) =>
          edge.label ? (
            <span key={i} data-edge-label={i} data-to={edge.to} aria-hidden="true" className={s.edgeLabel}>
              {edge.label}
            </span>
          ) : null,
        )}
        {slide.nodes.map((node, i) => (
          <div key={i} data-node={i} className={`${s.node} ${slide.layout === "hub" && i === 0 ? s.hub : ""}`}>
            <span className={s.nodeLabel}>{node.label}</span>
            {node.detail && <span className={s.nodeDetail}>{node.detail}</span>}
          </div>
        ))}
        <p className="sr-only">{said}</p>
      </div>
    </>
  );
}

// --- Closing ------------------------------------------------------------------------------

function ClosingSlide({ slide }: { slide: SlideOf<"closing"> }) {
  const points = slide.points ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2
        data-k="title"
        className={`${s.display} ${s.titleL} max-w-[18ch]`}
        style={fit(slide.title, [[16, 9.4], [36, 7.6], [64, 6.2]], 5.2)}
      >
        <Rich text={slide.title} />
      </h2>
      {points.length > 0 && (
        <ul className={s.checks} style={fs(points.length <= 3 ? 3.4 : 2.9)}>
          {points.map((point, i) => (
            <li key={i} data-k="check" className={s.check}>
              <span data-k="tick" aria-hidden="true" className={s.tick}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <path data-k="tickPath" d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span data-k="checkText" className={s.body}>
                <Rich text={point} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {slide.next && (
        <p data-k="next" className={s.next}>
          <span className={s.kicker}>Next</span>
          <span className={s.nextText}>{slide.next}</span>
          <span data-k="nextArrow" aria-hidden="true" className={s.nextArrow}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10h11M11 5l5 5-5 5" />
            </svg>
          </span>
        </p>
      )}
    </div>
  );
}
