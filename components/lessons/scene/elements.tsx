"use client";

import { useMemo } from "react";
import { Markdown } from "@/components/sandbox/Markdown";
import {
  elementBox,
  SCENE_STAGE,
  type SceneColor,
  type SceneElement,
  type SceneSize,
  type SceneTheme,
  type SceneTone,
} from "@/lib/scene";
import { fileNameFor, TOKEN_CLASS } from "../codeWindow";
import { tokenize } from "../highlight";

/**
 * How each kind of scene element looks on the stage. Everything is sized in
 * stage pixels (the stage is 1200 × 675 and scaled as a whole), so the type
 * scale here is for a full-size stage. The timeline (timeline.ts) finds parts
 * to animate by data attributes: `data-el` is an element's outer box (enter,
 * exit, move, emphasis), `data-dim` the inner layer focus dims, `data-flash`
 * the overlay a flash lights up, `data-part` the pieces of a cascade (list
 * items, code lines), and arrows carry `data-arrow-line` and `data-arrow-head`.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */

export function colorVar(color: SceneColor | undefined, fallback: string): string {
  // The raw tokens on :root (globals.css), not Tailwind's --color-* twins, which it only emits for classes in use.
  return color ? `var(--${color})` : fallback;
}

const HEADING_PX: Record<SceneSize, number> = { sm: 36, md: 48, lg: 64, xl: 84 };
const TEXT_PX: Record<SceneSize, number> = { sm: 20, md: 26, lg: 32, xl: 40 };
const CODE_PX: Record<SceneSize, number> = { sm: 17, md: 21, lg: 25, xl: 30 };
const NUMBER_PX: Record<SceneSize, number> = { sm: 48, md: 72, lg: 96, xl: 128 };

const SHAPE_RADIUS: Record<"rect" | "circle" | "pill" | "diamond", string> = {
  rect: "22px",
  circle: "9999px",
  pill: "9999px",
  diamond: "18px",
};

const TONE_STYLE: Record<SceneTone, { label: string; bg: string; badge: string; badgeText: string; icon: string }> = {
  tip: { label: "Tip", bg: "color-mix(in oklab, var(--highlighter) 40%, transparent)", badge: "var(--ink)", badgeText: "var(--highlighter)", icon: "✦" },
  definition: { label: "Definition", bg: "var(--card)", badge: "var(--highlighter)", badgeText: "var(--ink)", icon: "≡" },
  warning: { label: "Watch out", bg: "color-mix(in oklab, var(--red-pen) 12%, transparent)", badge: "var(--red-pen)", badgeText: "var(--paper)", icon: "!" },
  note: { label: "Note", bg: "var(--panel)", badge: "var(--charcoal)", badgeText: "var(--paper)", icon: "i" },
};

/** One element, positioned on the stage. Arrows are drawn by the SVG layer (ArrowLayer). */
export function StageElement({ element, theme }: { element: Exclude<SceneElement, { kind: "arrow" }>; theme: SceneTheme }) {
  const box = elementBox(element)!;
  const textColor = theme === "ink" ? "var(--paper)" : "var(--ink)";
  return (
    <div
      data-el={element.id}
      className="absolute will-change-transform"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div
        data-dim
        className="relative size-full rounded-[24px]"
        style={{ boxShadow: "0 0 0 var(--glow, 0px) var(--highlighter)" }}
      >
        <ElementBody element={element} textColor={textColor} theme={theme} />
        <div
          data-flash
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2 rounded-[26px] opacity-0"
          style={{ background: "var(--highlighter)", mixBlendMode: theme === "ink" ? "screen" : "multiply" }}
        />
      </div>
    </div>
  );
}

function ElementBody({
  element,
  textColor,
  theme,
}: {
  element: Exclude<SceneElement, { kind: "arrow" }>;
  textColor: string;
  theme: SceneTheme;
}) {
  switch (element.kind) {
    case "heading":
      return (
        <h3
          data-text
          className="m-0 font-semibold tracking-[-0.02em]"
          style={{
            fontSize: HEADING_PX[element.size ?? "md"],
            lineHeight: 1.05,
            textAlign: element.align ?? "left",
            color: colorVar(element.color, textColor),
            textWrap: "balance",
          }}
        >
          {element.text}
        </h3>
      );
    case "text":
      return (
        <div
          className="[&_p]:m-0 [&_p+p]:mt-[0.6em] [&_ul]:my-0 [&_ol]:my-0"
          style={{
            fontSize: TEXT_PX[element.size ?? "md"],
            lineHeight: 1.45,
            textAlign: element.align ?? "left",
            color: colorVar(element.color, textColor),
          }}
        >
          <Markdown source={element.md} />
        </div>
      );
    case "list":
      return (
        <ListBody
          items={element.items}
          ordered={element.ordered ?? false}
          px={TEXT_PX[element.size ?? "md"]}
          color={colorVar(element.color, textColor)}
          theme={theme}
        />
      );
    case "code":
      return <CodeBody language={element.language} code={element.code} px={CODE_PX[element.size ?? "md"]} />;
    case "image":
      return (
        // Lecturers' images come from anywhere; next/image would need every host allowed in advance.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={element.url}
          alt={element.alt}
          draggable={false}
          className="size-full rounded-[22px] ring-1 ring-ink/10"
          style={{ objectFit: element.fit ?? "cover", background: "var(--panel)" }}
        />
      );
    case "shape": {
      const fill = colorVar(element.fill, "var(--highlighter)");
      const labelColor = colorVar(element.color, element.fill === "ink" || element.fill === "charcoal" ? "var(--paper)" : "var(--ink)");
      const diamond = element.shape === "diamond";
      return (
        <div className="grid size-full place-items-center" style={{ containerType: "size" }}>
          <div
            className="absolute inset-0"
            style={{
              background: fill,
              borderRadius: SHAPE_RADIUS[element.shape],
              boxShadow: element.stroke ? `inset 0 0 0 4px ${colorVar(element.stroke, "transparent")}` : undefined,
              transform: diamond ? "rotate(45deg) scale(0.74)" : undefined,
            }}
          />
          {element.label && (
            <span
              data-text
              className="relative px-4 text-center font-semibold leading-tight tracking-[-0.01em]"
              style={{ color: labelColor, fontSize: 24, textWrap: "balance" }}
            >
              {element.label}
            </span>
          )}
        </div>
      );
    }
    case "number":
      return (
        <NumberBody
          value={element.value}
          prefix={element.prefix}
          suffix={element.suffix}
          decimals={element.decimals ?? 0}
          label={element.label}
          px={NUMBER_PX[element.size ?? "md"]}
          color={colorVar(element.color, textColor)}
        />
      );
    case "note": {
      const tone = TONE_STYLE[element.tone];
      return (
        <aside
          className="flex size-full flex-col justify-center rounded-[22px] px-6 py-4"
          style={{ background: tone.bg, color: "var(--ink)" }}
          aria-label={tone.label}
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full text-[16px] font-semibold"
              style={{ background: tone.badge, color: tone.badgeText }}
            >
              {tone.icon}
            </span>
            <span className="text-[14px] font-semibold uppercase tracking-[0.14em] text-graphite">{tone.label}</span>
          </div>
          <div className="mt-2 text-[20px] leading-[1.45] [&_p]:m-0">
            <Markdown source={element.md} />
          </div>
        </aside>
      );
    }
  }
}

function ListBody({ items, ordered, px, color, theme }: { items: string[]; ordered: boolean; px: number; color: string; theme: SceneTheme }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="m-0 list-none p-0" style={{ fontSize: px, lineHeight: 1.4, color }}>
      {items.map((item, i) => (
        <li key={i} data-part className="flex items-start gap-[0.55em] py-[0.22em]">
          <span
            aria-hidden="true"
            className="mt-[0.3em] grid shrink-0 place-items-center rounded-full font-semibold"
            style={{
              width: ordered ? "1.5em" : "0.5em",
              height: ordered ? "1.5em" : "0.5em",
              marginTop: ordered ? "0" : "0.5em",
              fontSize: ordered ? "0.7em" : undefined,
              background: theme === "ink" ? "var(--highlighter)" : "var(--ink)",
              color: theme === "ink" ? "var(--ink)" : "var(--paper)",
            }}
          >
            {ordered ? i + 1 : ""}
          </span>
          <span className="min-w-0 flex-1 [&_p]:m-0">
            <Markdown source={item} />
          </span>
        </li>
      ))}
    </Tag>
  );
}

function CodeBody({ language, code, px }: { language: string; code: string; px: number }) {
  const lines = useMemo(() => tokenize(language, code), [language, code]);
  const gutter = String(lines.length).length;
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[22px] bg-charcoal text-code-text shadow-[0_24px_60px_-30px_rgba(20,20,20,0.7)]">
      <div className="flex items-center gap-3 border-b border-paper/10 px-5 py-3">
        <span aria-hidden="true" className="flex gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-2.5 rounded-full bg-paper/20" />
          ))}
        </span>
        <span className="font-mono text-[14px] tracking-[0.08em] text-paper/60">{fileNameFor(language)}</span>
      </div>
      <pre className="m-0 flex-1 overflow-hidden py-3 font-mono" style={{ fontSize: px, lineHeight: 1.6 }}>
        <code className="block">
          {lines.map((line, n) => (
            <span key={n} data-part className="flex">
              <span aria-hidden="true" className="shrink-0 select-none pl-5 pr-4 text-right text-code-line" style={{ minWidth: `${gutter + 2.5}ch` }}>
                {n + 1}
              </span>
              <span className="whitespace-pre pr-5">
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
  );
}

function NumberBody({
  value,
  prefix,
  suffix,
  decimals,
  label,
  px,
  color,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals: number;
  label?: string;
  px: number;
  color: string;
}) {
  return (
    <div className="flex size-full flex-col justify-center" style={{ color }}>
      <p className="m-0 font-semibold tabular-nums tracking-[-0.03em]" style={{ fontSize: px, lineHeight: 1 }}>
        {prefix}
        {/* The timeline counts this up; the final value is in the markup so the scene reads without it. */}
        <span data-count data-value={value} data-decimals={decimals}>
          {formatNumber(value, decimals)}
        </span>
        {suffix}
      </p>
      {label && (
        <p className="m-0 mt-[0.35em] font-medium opacity-70" style={{ fontSize: Math.max(18, px * 0.3), lineHeight: 1.2 }}>
          {label}
        </p>
      )}
    </div>
  );
}

export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The arrows, drawn over the stage in stage coordinates. The timeline lays them out and keeps them attached. */
export function ArrowLayer({ arrows, theme }: { arrows: Extract<SceneElement, { kind: "arrow" }>[]; theme: SceneTheme }) {
  const stroke = theme === "ink" ? "var(--paper)" : "var(--ink)";
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${SCENE_STAGE.width} ${SCENE_STAGE.height}`}
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {arrows.map((arrow) => {
        const color = colorVar(arrow.color, stroke);
        return (
          <g key={arrow.id} data-el={arrow.id} data-arrow data-from={arrow.from} data-to={arrow.to} data-curve={arrow.curve ?? 0}>
            <g data-dim>
              <path data-arrow-line d="" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
              <path data-arrow-head d="M -16 -10 L 2 0 L -16 10 Z" fill={color} />
              {arrow.label && (
                <g data-arrow-label>
                  <rect data-arrow-label-bg rx={12} ry={12} fill={theme === "ink" ? "var(--ink)" : "var(--paper)"} />
                  <text
                    data-arrow-label-text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={20}
                    fontWeight={600}
                    fill={color}
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {arrow.label}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
