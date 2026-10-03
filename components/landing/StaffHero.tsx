import type { ReactNode } from "react";
import { LiveMonitorMock } from "@/components/landing/mockups";
import { SimilarityMock } from "@/components/landing/staffMockups";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { ArrowLink, buttonClass } from "@/components/ui/buttons";
import { Eye, Pen, Scale } from "@/components/ui/icons";
import { Scribble } from "@/components/ui/Scribble";

function Chip({ children, tone = "card" }: { children: ReactNode; tone?: "card" | "panel" }) {
  return (
    <span className={`grid size-14 shrink-0 place-items-center rounded-full ${tone === "card" ? "bg-card" : "bg-panel"}`}>
      {children}
    </span>
  );
}

export function StaffHero() {
  return (
    <section className="px-3 pt-5 sm:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.75rem] bg-panel px-5 pb-5 pt-14 sm:px-10 sm:pb-8 sm:pt-20 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:items-end lg:gap-16">
          <div>
            <Reveal
              as="p"
              kind="left"
              className="-rotate-2 font-hand text-[1.75rem] leading-none text-graphite sm:text-[2.2rem]"
            >
              For lecturers and universities
            </Reveal>
            <AnimatedHeading
              as="h1"
              delay={0.2}
              className="mt-6 text-[2.85rem] font-medium leading-[0.98] tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]"
            >
              The control room for{" "}
              <span className="whitespace-nowrap">
                <Scribble delay={1.3}>honest</Scribble> exams.
              </span>
            </AnimatedHeading>
          </div>
          <div className="space-y-7 lg:pb-3">
            <RevealGroup stagger={0.12} delay={0.5} className="flex gap-2.5">
              <RevealItem kind="pop">
                <Chip>
                  <Eye className="size-6" />
                </Chip>
              </RevealItem>
              <RevealItem kind="pop">
                <Chip>
                  <Pen className="size-6" />
                </Chip>
              </RevealItem>
              <RevealItem kind="pop">
                <Chip>
                  <Scale className="size-6" />
                </Chip>
              </RevealItem>
            </RevealGroup>
            <Reveal as="p" delay={0.65} className="max-w-md text-lg leading-relaxed text-graphite">
              Build courses, run quizzes and exams, and watch the whole class live: who is working,
              who is stuck and who is probably cheating. The system flags; you decide.
            </Reveal>
            <Reveal delay={0.8} className="flex flex-wrap items-center gap-3">
              <ArrowLink href="/sign-in" tone="lime">
                Sign in
              </ArrowLink>
              <a href="mailto:hello@kalami.space" className={buttonClass("outline", "lg")}>
                Request a pilot
              </a>
            </Reveal>
            <Reveal as="p" kind="pop" delay={1.2} className="-rotate-1 font-hand text-xl text-graphite">
              Staff accounts are invite-only.
            </Reveal>
          </div>
        </div>

        <RevealGroup stagger={0.18} delay={0.3} className="mt-14 grid gap-4 *:min-w-0 lg:mt-20 lg:grid-cols-12">
          <RevealItem as="article" kind="scale" hover className="notch-top rounded-[2rem] bg-card p-5 sm:p-7 lg:col-span-7">
            <div className="mb-5 flex items-center gap-3">
              <Chip tone="panel">
                <Eye className="size-6" />
              </Chip>
              <div>
                <h3 className="text-2xl font-medium tracking-tight">Live monitor</h3>
                <p className="text-sm text-graphite">Real time, no refresh. Unlock or add time in one click.</p>
              </div>
            </div>
            <LiveMonitorMock />
          </RevealItem>
          <RevealItem as="article" kind="scale" hover className="flex flex-col rounded-[2rem] bg-charcoal p-5 text-paper sm:p-7 lg:col-span-5">
            <div className="flex items-center gap-3">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-charcoal-soft">
                <Scale className="size-6" />
              </span>
              <div>
                <h3 className="text-2xl font-medium tracking-tight">Similarity report</h3>
                <p className="text-sm text-paper/60">After close, every pair of submissions compared.</p>
              </div>
            </div>
            <div className="mt-6 rounded-[1.5rem] bg-card p-4 text-ink">
              <SimilarityMock />
            </div>
            <Reveal as="p" kind="pop" delay={1} className="mt-5 -rotate-1 font-hand text-xl leading-tight text-highlighter">
              A flag is a reason to look closer, not a verdict.
            </Reveal>
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}
