"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BuilderMock } from "@/components/landing/staffMockups";
import { ArrowButton, Button, buttonClass } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Check, Layers, Robot, Shield } from "@/components/ui/icons";
import { CircledLabel } from "@/components/ui/Scribble";
import { useOrigin } from "@/lib/useOrigin";

/**
 * The card that greets lecturers and admins the first time they open the studio:
 * what they can build here, how to plug their own AI agent in through MCP, and
 * why they stay in control. Reopens from "How it works" on the dashboard.
 */

type Step = {
  eyebrow: string;
  note: string;
  title: ReactNode;
  body: string;
  points: string[];
  icon: ReactNode;
  visual: (origin: string) => ReactNode;
};

const STEPS: Step[] = [
  {
    eyebrow: "Step 1",
    note: "Start here!",
    title: (
      <>
        Quizzes, midterms and finals,
        <br />
        built in minutes
      </>
    ),
    body: "A course is the folder. Inside it you add quizzes for practice and midterms and finals for the real thing. Everything starts as a draft that only you can see.",
    points: [
      "Single choice, multiple choice, short answer and essay questions",
      "Exams default to strict integrity: fullscreen, one tab, server timer",
      "Students will join a course with its six-character code (coming soon)",
    ],
    icon: <Layers className="size-5" />,
    visual: () => (
      <div className="pointer-events-none select-none rounded-[1.5rem] bg-card p-4 shadow-[0_30px_60px_-35px_rgba(20,20,20,0.45)]" aria-hidden>
        <BuilderMock />
      </div>
    ),
  },
  {
    eyebrow: "Step 2",
    note: "The heavy lifting",
    title: (
      <>
        Let your own AI agent
        <br />
        write the drafts
      </>
    ),
    body: "Kalami speaks MCP, so Claude Code, Claude Desktop, Cursor and friends can draft whole assessments for you. Create a personal token on the Agents page, paste one line into your agent, and ask.",
    points: [
      "Your agent can list courses, create assessments and add questions",
      "It works as you: it only sees courses you can edit",
      "Revoke the token any time; it stops working instantly",
    ],
    icon: <Robot className="size-5" />,
    visual: (origin) => (
      <div className="space-y-3" aria-hidden>
        <pre className="no-scrollbar overflow-x-auto rounded-2xl bg-charcoal px-5 py-4 font-mono text-[12.5px] leading-relaxed text-paper">
          {`claude mcp add --transport http kalami \\\n  ${origin}/api/mcp \\\n  --header "Authorization: Bearer klm_…"`}
        </pre>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-[1.4rem] rounded-br-md bg-highlighter px-4 py-3 text-sm leading-snug text-ink">
            Draft a 10-question quiz on CSS selectors for my Web basics course, in Georgian.
          </p>
        </div>
        <div className="flex">
          <p className="max-w-[85%] rounded-[1.4rem] rounded-bl-md bg-card px-4 py-3 text-sm leading-snug text-graphite shadow-[0_20px_40px_-30px_rgba(20,20,20,0.5)]">
            Done. Created the draft quiz “CSS selectors” with 10 questions. Review and publish it in Kalami when you’re happy.
          </p>
        </div>
      </div>
    ),
  },
  {
    eyebrow: "Step 3",
    note: "Your call, always",
    title: (
      <>
        Agents draft.
        <br />
        You publish.
      </>
    ),
    body: "Nothing an agent makes reaches a student until you press Publish. Every change, by you or your agent, is written down, and answer keys never leave the staff side.",
    points: [
      "Agents can't publish, delete or see students and grades",
      "Each course shows its history: what changed, who, and whether an agent did it",
      "Only lecturers, university admins and the platform admin can be here",
    ],
    icon: <Shield className="size-5" />,
    visual: () => (
      <ul className="space-y-2.5 rounded-[1.5rem] bg-charcoal p-5 text-paper" aria-hidden>
        {[
          ["Draft quiz “CSS selectors”", "by your agent · 2 min ago", true],
          ["Added 10 questions", "by your agent · 2 min ago", true],
          ["Published “HTML basics”", "by you · yesterday", false],
          ["Revoked token “Old laptop”", "by you · 3 d ago", false],
        ].map(([what, who, agent]) => (
          <li key={String(what)} className="flex items-center gap-3 rounded-2xl bg-charcoal-soft px-4 py-2.5 text-sm">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full ${agent ? "bg-highlighter text-ink" : "bg-paper/15 text-paper"}`}>
              {agent ? <Robot className="size-4" /> : <Check className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{what}</span>
              <span className="block text-xs text-paper/55">{who}</span>
            </span>
          </li>
        ))}
      </ul>
    ),
  },
];

export function StudioIntro({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const origin = useOrigin();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const close = () => {
    onClose();
    setIndex(0);
  };

  return (
    <Dialog open={open} onClose={close} label="How the studio works" size="lg">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-highlighter text-ink">{step.icon}</span>
            <CircledLabel>{step.eyebrow}</CircledLabel>
          </div>
          <p className="mt-6 -rotate-2 font-hand text-[1.7rem] leading-none text-graphite">{step.note}</p>
          <h2 className="mt-3 text-3xl font-medium leading-[1.02] tracking-[-0.04em] sm:text-[2.6rem]">{step.title}</h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-graphite">{step.body}</p>
          <ul className="mt-5 space-y-2.5">
            {step.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] leading-snug">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-highlighter text-ink">
                  <Check className="size-3" />
                </span>
                {point}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3 pt-2 lg:mt-auto">
            <div className="mr-auto flex items-center gap-2" role="tablist" aria-label="Steps">
              {STEPS.map((s, i) => (
                <button
                  key={s.eyebrow}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={s.eyebrow}
                  onClick={() => setIndex(i)}
                  className={`h-2.5 rounded-full transition-all ${i === index ? "w-7 bg-ink" : "w-2.5 bg-ink/20 hover:bg-ink/40"}`}
                />
              ))}
            </div>
            {index > 0 && (
              <Button variant="ghost" onClick={() => setIndex(index - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <>
                <Link href="/agents" onClick={close} className={buttonClass("outline")}>
                  Connect an agent
                </Link>
                <ArrowButton tone="lime" onClick={close}>
                  Got it, let’s build
                </ArrowButton>
              </>
            ) : (
              <ArrowButton onClick={() => setIndex(index + 1)}>Next</ArrowButton>
            )}
          </div>
        </div>

        <div className="notch-top rounded-[2rem] bg-panel p-5 sm:p-6 lg:self-stretch lg:pt-10">{step.visual(origin)}</div>
      </div>
    </Dialog>
  );
}
