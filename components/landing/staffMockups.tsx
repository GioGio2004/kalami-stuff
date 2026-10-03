import type { ReactNode } from "react";
import { Bar } from "@/components/motion/primitives";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";

// Staff tool mockups. Plain markup that follows the theme tokens; names and numbers
// are illustrative.

function Pill({ children, tone = "panel" }: { children: ReactNode; tone?: "panel" | "lime" | "ink" | "red" }) {
  const tones = {
    panel: "bg-panel text-graphite",
    lime: "bg-highlighter text-ink",
    ink: "bg-ink text-paper",
    red: "bg-red-pen/10 text-red-pen",
  };
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

const weeks = [
  {
    title: "Week 1 · HTML",
    items: [
      { kind: "Lesson", title: "What a web page is", state: "Published", tone: "lime" },
      { kind: "Task", title: "Your first page", state: "Published", tone: "lime" },
    ],
  },
  {
    title: "Week 2 · CSS",
    items: [
      { kind: "Lesson", title: "Boxes and borders", state: "Published", tone: "lime" },
      { kind: "Quiz", title: "Selectors", state: "Draft", tone: "panel" },
      { kind: "Exam", title: "Midterm · strict", state: "Opens Mar 20", tone: "ink" },
    ],
  },
] as const;

export function StudioMock() {
  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-3">
        <div>
          <p className="text-xs text-graphite">Spring 2026 · 28 students</p>
          <p className="text-lg font-semibold tracking-tight">Web basics</p>
        </div>
        <span className="rounded-full bg-panel px-3 py-1.5 font-mono text-xs tracking-wider">KLM-4821</span>
      </div>
      <div className="space-y-3">
        {weeks.map((week) => (
          <div key={week.title} className="rounded-2xl border border-line p-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-graphite">{week.title}</p>
            <RevealGroup as="ul" stagger={0.1} className="mt-2 space-y-1.5">
              {week.items.map((item) => (
                <RevealItem as="li" kind="left" key={item.title} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2">
                  <span className="w-12 shrink-0 text-xs text-graphite">{item.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                  <Pill tone={item.tone}>{item.state}</Pill>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        ))}
      </div>
    </div>
  );
}

const questions = [
  { type: "Single choice", prompt: "Which tag makes a link?", points: 2 },
  { type: "Code", prompt: "Build a nav with three items", points: 5 },
  { type: "Short answer", prompt: "What does CSS stand for?", points: 1 },
  { type: "Essay", prompt: "Explain the box model", points: 4 },
];

export function BuilderMock() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3">
        <p className="text-lg font-semibold tracking-tight">Midterm · Web basics</p>
        <Pill tone="ink">Integrity: strict</Pill>
      </div>
      <div className="flex flex-wrap gap-1.5 px-1 pb-4">
        {["60 min", "1 attempt", "Shuffle questions", "Results after close"].map((setting) => (
          <Pill key={setting}>{setting}</Pill>
        ))}
      </div>
      <RevealGroup as="ol" stagger={0.12} className="space-y-2">
        {questions.map((question, index) => (
          <RevealItem as="li" kind="left" key={question.prompt} className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel text-xs font-semibold">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{question.prompt}</p>
              <p className="text-xs text-graphite">{question.type}</p>
            </div>
            <span className="text-xs tabular-nums text-graphite">{question.points} pts</span>
          </RevealItem>
        ))}
      </RevealGroup>
      <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl border-2 border-dashed border-line p-3">
        <span className="mr-1 self-center text-xs text-graphite">Add</span>
        {["Matching", "Ordering", "Code", "Survey"].map((type) => (
          <Pill key={type} tone="lime">
            + {type}
          </Pill>
        ))}
      </div>
    </div>
  );
}

export function GradingMock() {
  const code = [".card {", "  display: block;", "  gap: 12px;", "  padding: 16px;", "}"];
  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-3">
        <div>
          <p className="text-xs text-graphite">Task 2 · Your profile card</p>
          <p className="text-lg font-semibold tracking-tight">Ana B. · style.css</p>
        </div>
        <span className="rounded-full bg-panel px-3 py-1.5 text-sm font-semibold tabular-nums">4 / 5</span>
      </div>
      <pre className="overflow-hidden rounded-2xl border border-line bg-paper p-4 font-mono text-[12.5px] leading-7">
        {code.map((line, index) => (
          <div key={index} className={`flex gap-3 ${index === 2 ? "-mx-2 rounded-lg bg-red-pen/10 px-2" : ""}`}>
            <span className="w-4 select-none text-right text-graphite/50">{index + 1}</span>
            <span className={index === 2 ? "text-red-pen underline decoration-wavy decoration-2 underline-offset-4" : ""}>
              {line}
            </span>
          </div>
        ))}
      </pre>
      <div className="mt-3 flex items-start gap-3">
        <p className="flex-1 -rotate-1 rounded-2xl bg-card px-4 py-2.5 font-hand text-[1.4rem] leading-tight text-red-pen shadow-[0_10px_30px_-18px_rgba(20,20,20,0.5)]">
          gap does nothing without flex or grid!
        </p>
        <span className="mt-1 shrink-0 rounded-full bg-ink px-3.5 py-2 text-xs font-medium text-paper">Return</span>
      </div>
    </div>
  );
}

const pairs = [
  { a: "Ana B.", b: "Luka T.", score: 92 },
  { a: "Mariam S.", b: "Nino M.", score: 41 },
  { a: "Giorgi K.", b: "Ana B.", score: 18 },
];

export function SimilarityMock() {
  return (
    <RevealGroup as="ul" stagger={0.15} className="space-y-3">
      {pairs.map((pair, index) => (
        <RevealItem as="li" kind="up" key={`${pair.a}-${pair.b}`} className="rounded-2xl border border-line p-3.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium">
              {pair.a} <span className="text-graphite">and</span> {pair.b}
            </span>
            <span className={`font-semibold tabular-nums ${pair.score > 80 ? "text-red-pen" : "text-graphite"}`}>
              {pair.score}%
            </span>
          </div>
          <Bar
            percent={pair.score}
            delay={0.3 + index * 0.15}
            className="mt-2.5 h-1.5 rounded-full bg-panel"
            fillClassName={pair.score > 80 ? "bg-red-pen" : "bg-ink/40"}
          />
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
