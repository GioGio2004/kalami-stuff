import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { Float } from "@/components/motion/primitives";
import { Enter, RevealGroup, RevealItem } from "@/components/motion/Reveal";

/** Sign-in / sign-up layout: a brand panel beside Clerk's (themed) form. */
export function AuthShell({
  note,
  title,
  body,
  visual,
  children,
}: {
  note: string;
  title: ReactNode;
  body: string;
  visual?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 px-3 py-3 sm:px-6 sm:py-4">
      <div className="mx-auto grid w-full max-w-[88rem] flex-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Enter as="section" kind="left" className="flex flex-col rounded-[2.75rem] bg-panel p-6 sm:p-10 lg:p-14">
          <Enter kind="drop" delay={0.1}>
            <Link href="/" aria-label="Kalami home" className="block w-fit">
              <Logo />
            </Link>
          </Enter>
          <div className="mt-10 lg:mt-16">
            <Enter as="p" kind="left" delay={0.25} className="-rotate-2 font-hand text-[1.75rem] leading-none text-graphite">
              {note}
            </Enter>
            <AnimatedHeading
              as="h1"
              delay={0.35}
              className="mt-4 text-4xl font-medium leading-[1] tracking-[-0.045em] sm:text-6xl"
            >
              {title}
            </AnimatedHeading>
            <Enter as="p" delay={0.7} className="mt-5 max-w-md text-lg leading-relaxed text-graphite">
              {body}
            </Enter>
          </div>
          {visual && (
            <Enter delay={0.9} kind="up" className="mt-auto hidden pt-12 lg:block">
              <Float amplitude={7} duration={7} rotate={0.5}>
                {visual}
              </Float>
            </Enter>
          )}
        </Enter>
        <Enter as="section" kind="up" delay={0.3} className="flex items-center justify-center py-4 lg:py-10">
          {children}
        </Enter>
      </div>
    </div>
  );
}

/** Numbered steps with lime ticks for the finished ones. */
export function StepsCard({
  title,
  steps,
  done,
}: {
  title: string;
  steps: { title: string; text: string }[];
  done: number;
}) {
  return (
    <div className="max-w-md rotate-[-1.5deg] rounded-[2rem] bg-card p-6 shadow-[0_30px_60px_-35px_rgba(20,20,20,0.45)]">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-graphite">{title}</p>
      <RevealGroup as="ol" stagger={0.2} delay={1.2} className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <RevealItem as="li" kind="left" key={step.title} className="flex gap-3.5">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                index < done ? "bg-highlighter text-ink" : "bg-panel text-graphite"
              }`}
            >
              {index + 1}
            </span>
            <span>
              <span className="block font-medium">{step.title}</span>
              <span className="text-sm text-graphite">{step.text}</span>
            </span>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
