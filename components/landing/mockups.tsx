import type { ReactNode } from "react";
import { Bar } from "@/components/motion/primitives";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Check, Cross, Shield } from "@/components/ui/icons";

// Product mockups for the feature carousel. Plain markup, so they stay sharp and
// follow the theme tokens. Names and numbers are illustrative.

export function NotebookMock() {
  const courses = [
    { title: "Web basics", percent: 64, next: "Flexbox in practice" },
    { title: "Databases", percent: 28, next: "Joins, gently" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-xs text-graphite">Good morning, Ana</p>
          <p className="text-lg font-semibold tracking-tight">My notebook</p>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-highlighter text-xs font-semibold">
          AB
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-red-pen/10 px-4 py-3">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-pen" />
        <p className="flex-1 text-sm font-medium">Open now · Quiz 3, CSS layout</p>
        <span className="font-mono text-sm tabular-nums text-red-pen">01:12:44</span>
      </div>
      {courses.map((course) => (
        <div key={course.title} className="rounded-2xl border border-line p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-medium">{course.title}</p>
            <p className="text-xs tabular-nums text-graphite">{course.percent}%</p>
          </div>
          <Bar percent={course.percent} delay={0.3} className="mt-3 h-1.5 rounded-full bg-panel" />
          <p className="mt-2.5 text-xs text-graphite">Up next · {course.next}</p>
        </div>
      ))}
    </div>
  );
}

const monitorRows = [
  { name: "Ana B.", online: true, done: 14, flag: "No flags", level: "ok" },
  { name: "Giorgi K.", online: true, done: 6, flag: "Away 42s · 3 tabs", level: "warn" },
  { name: "Nino M.", online: false, done: 0, flag: "Left fullscreen ×2", level: "flag", locked: true },
  { name: "Mariam S.", online: true, done: 9, flag: "Big paste blocked", level: "warn" },
  { name: "Luka T.", online: true, done: 11, flag: "No flags", level: "ok" },
] as const;

const levelDot = { ok: "bg-ok", warn: "bg-warn", flag: "bg-red-pen" };

export function LiveMonitorMock() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
        <div>
          <p className="text-xs text-graphite">Midterm · Web basics</p>
          <p className="text-lg font-semibold tracking-tight">24 online · 2 need attention</p>
        </div>
        <div className="flex rounded-full bg-panel p-1 text-xs font-medium">
          <span className="rounded-full px-3 py-1.5 text-graphite">All</span>
          <span className="rounded-full bg-ink px-3 py-1.5 text-paper">Needs attention</span>
        </div>
      </div>
      <RevealGroup as="ul" stagger={0.12} className="divide-y divide-line rounded-2xl border border-line">
        {monitorRows.map((row, index) => (
          <RevealItem
            as="li"
            kind="left"
            key={row.name}
            className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[7.5rem_1fr_auto]"
          >
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${row.online ? "bg-ok" : "bg-line"}`} />
              <span className="text-sm font-medium">{row.name}</span>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <Bar
                percent={(row.done / 20) * 100}
                delay={0.3 + index * 0.12}
                className="h-1.5 flex-1 rounded-full bg-panel"
              />
              <span className="w-9 text-right text-xs tabular-nums text-graphite">
                {row.done ? `${row.done}/20` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2 justify-self-end">
              <span className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-xs">
                <span className={`size-1.5 rounded-full ${levelDot[row.level]}`} />
                {row.flag}
              </span>
              {"locked" in row && (
                <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-paper">
                  Unlock
                </span>
              )}
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-ink">{children}</span>;
}

export function SandboxMock() {
  const lines: ReactNode[] = [
    <>
      &lt;<Tag>nav</Tag>&gt;
    </>,
    <>
      {"  "}&lt;<Tag>a</Tag>&gt;Home&lt;/<Tag>a</Tag>&gt; &lt;<Tag>a</Tag>&gt;Work&lt;/<Tag>a</Tag>&gt;
    </>,
    <>
      &lt;/<Tag>nav</Tag>&gt;
    </>,
    <>
      &lt;<Tag>div</Tag> class=<span className="rounded bg-highlighter/70 px-0.5">&quot;card&quot;</span>&gt;
    </>,
    <>
      {"  "}&lt;<Tag>h1</Tag>&gt;Ana Beridze&lt;/<Tag>h1</Tag>&gt;
    </>,
    <>
      {"  "}&lt;<Tag>p</Tag>&gt;Student · Web basics&lt;/<Tag>p</Tag>&gt;
    </>,
    <>
      &lt;/<Tag>div</Tag>&gt;
      <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-ink" />
    </>,
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="flex items-center gap-1 border-b border-line bg-panel/60 px-3 py-2 text-xs">
        <span className="rounded-lg bg-card px-2.5 py-1 font-medium shadow-sm">index.html</span>
        <span className="px-2.5 py-1 text-graphite">style.css</span>
        <span className="ml-auto flex items-center gap-1.5 text-graphite">
          <Shield className="size-3.5" />
          Paste blocked
        </span>
      </div>
      <div className="grid sm:grid-cols-[1.3fr_1fr]">
        <pre className="relative overflow-hidden p-4 font-mono text-[12.5px] leading-6 text-graphite sm:border-r sm:border-line">
          <RevealGroup stagger={0.3} delay={0.2}>
            {lines.map((line, i) => (
              <RevealItem kind="left" key={i} className="flex gap-3">
                <span className="w-4 select-none text-right text-line">{i + 1}</span>
                <span>{line}</span>
              </RevealItem>
            ))}
          </RevealGroup>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 grid -rotate-12 place-items-center text-2xl font-semibold text-ink/[0.05]"
          >
            Ana Beridze · Ana Beridze
          </span>
        </pre>
        <div className="border-t border-line bg-paper p-4 sm:border-t-0">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-graphite">
            Preview
          </p>
          <div className="rounded-xl bg-card p-3 shadow-sm">
            <div className="flex gap-3 text-[11px] text-graphite">
              <span>Home</span>
              <span>Work</span>
            </div>
            <p className="mt-3 text-base font-semibold text-[#e4572e]">Ana Beridze</p>
            <p className="text-xs text-graphite">Student · Web basics</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-xs">
        <RevealGroup stagger={0.35} delay={2.4} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <RevealItem kind="pop">
            <CheckResult passed>has &lt;nav&gt;</CheckResult>
          </RevealItem>
          <RevealItem kind="pop">
            <CheckResult passed>h1 colour</CheckResult>
          </RevealItem>
          <RevealItem kind="pop">
            <CheckResult passed={false}>.card uses flex</CheckResult>
          </RevealItem>
        </RevealGroup>
        <span className="ml-auto rounded-full bg-ink px-3.5 py-1.5 font-medium text-paper">Submit</span>
      </div>
    </div>
  );
}

function CheckResult({ passed, children }: { passed: boolean; children: ReactNode }) {
  return (
    <span className={`flex items-center gap-1.5 font-mono ${passed ? "" : "text-red-pen"}`}>
      <span
        className={`grid size-4 place-items-center rounded-full ${passed ? "bg-highlighter text-ink" : "bg-red-pen/10"}`}
      >
        {passed ? <Check className="size-2.5" /> : <Cross className="size-2.5" />}
      </span>
      {children}
    </span>
  );
}

export function VariantsMock() {
  const variants = [
    { student: "Ana B.", place: "Ana's Café", items: 3, color: "#e4572e", tilt: "-rotate-2" },
    { student: "Giorgi K.", place: "Giorgi's Garage", items: 5, color: "#2e86de", tilt: "rotate-1" },
  ];
  return (
    <div className="space-y-5 p-1">
      <p className="rounded-xl bg-panel px-3 py-2 font-mono text-xs text-graphite">
        variant = seed(studentId + assessmentId)
      </p>
      <RevealGroup stagger={0.25} delay={0.2} className="grid gap-4 sm:grid-cols-2">
        {variants.map((variant) => (
          <RevealItem
            kind="scale"
            hover
            key={variant.student}
            className={`rounded-2xl border border-line bg-card p-4 shadow-[0_12px_30px_-18px_rgba(20,20,20,0.4)] ${variant.tilt}`}
          >
            <p className="text-xs text-graphite">{variant.student}&apos;s task</p>
            <p className="mt-2 text-sm leading-relaxed">
              Build a menu for <strong>{variant.place}</strong> with{" "}
              <strong>{variant.items} items</strong>. Heading colour{" "}
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                <span className="inline-block size-3 rounded" style={{ background: variant.color }} />
                {variant.color}
              </span>
            </p>
            <div className="mt-3 h-1.5 rounded-full" style={{ background: variant.color }} />
          </RevealItem>
        ))}
      </RevealGroup>
      <Reveal as="p" kind="pop" delay={0.9} className="-rotate-1 text-center font-hand text-[1.4rem] text-red-pen">
        Same task, a different answer for each person.
      </Reveal>
    </div>
  );
}
