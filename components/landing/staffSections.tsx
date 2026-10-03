import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { KalamiMark, Logo } from "@/components/Logo";
import { BuilderMock, GradingMock, StudioMock } from "@/components/landing/staffMockups";
import { ToolsTabs, type Tool } from "@/components/landing/ToolsTabs";
import { ArrowLink, buttonClass } from "@/components/ui/buttons";
import { Building, Layers, ListChecks, Mail, Pen, Shield, Sparkle } from "@/components/ui/icons";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Float } from "@/components/motion/primitives";
import { CircledLabel, ScribbleUnderline } from "@/components/ui/Scribble";
import { STUDENT_APP_URL } from "@/lib/urls";

const tools: Tool[] = [
  {
    id: "studio",
    label: "Course studio",
    icon: <Layers className="size-4" />,
    title: "Build a course the way you teach it",
    body: "Weeks hold lessons, code tasks, quizzes and exams, in order. Everything is a draft until you publish it, and students only see what is open.",
    points: [
      "Lessons with code blocks, images and YouTube, written in Georgian or English",
      "Tag the concepts a lesson teaches to catch work that uses what wasn't taught yet",
      "A join code per course that you can regenerate or switch off",
    ],
    mock: <StudioMock />,
  },
  {
    id: "builder",
    label: "Assessment builder",
    icon: <ListChecks className="size-4" />,
    title: "Quizzes, exams and code tasks",
    body: "Pick the question types, the time limit, the attempts and the integrity level. The server keeps the clock, so nobody gets extra minutes from a slow laptop.",
    points: [
      "Single and multiple choice, short answer, essay, matching, ordering and code",
      "Per-student variants of code tasks, generated from who the student is",
      "Results hidden, score only, or full answers after the exam closes",
    ],
    mock: <BuilderMock />,
  },
  {
    id: "grading",
    label: "Red-pen grading",
    icon: <Pen className="size-4" />,
    title: "Mark a line, leave a note",
    body: "Auto-graded questions score themselves. Essays and code land in a queue where you highlight lines and write red-pen notes students see on their work.",
    points: [
      "Checks run again on the server for every code submission",
      "An integrity timeline next to each attempt, with the reasons for every flag",
      "Per-question statistics to spot a confusing question",
    ],
    mock: <GradingMock />,
  },
];

export function ToolsSection() {
  return (
    <section id="tools" className="scroll-mt-28 px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-[76rem]">
        <ToolsTabs
          tools={tools}
          heading={
            <div>
              <Reveal kind="left">
                <CircledLabel>Tools</CircledLabel>
              </Reveal>
              <AnimatedHeading
                as="h2"
                className="mt-5 max-w-2xl text-4xl font-medium leading-[1.02] tracking-[-0.04em] sm:text-6xl"
              >
                Everything a course needs. Nothing it doesn&apos;t.
              </AnimatedHeading>
            </div>
          }
        />
      </div>
    </section>
  );
}

const examSteps = [
  { title: "Start", text: "Each student presses Start. The server checks the window and sets one deadline." },
  { title: "Autosave", text: "Answers save seconds after typing stops and survive refreshes and lost Wi-Fi." },
  { title: "Watch live", text: "Progress, time away and tab switches per student. Unlock or add time in a click." },
  { title: "Time's up", text: "At the deadline the server submits every attempt, even if the browser is closed." },
  { title: "Grade", text: "Auto-graded parts score at once; essays and code wait for your red pen." },
];

export function LiveExamSteps() {
  return (
    <section id="live" className="scroll-mt-28 px-4 pb-24 sm:px-6 sm:pb-32">
      <div className="mx-auto max-w-[76rem]">
        <Reveal as="p" kind="left" className="text-xs font-semibold uppercase tracking-[0.22em] text-graphite">
          How a live exam runs
        </Reveal>
        <AnimatedHeading
          as="h2"
          className="mt-5 max-w-4xl text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-7xl"
        >
          The server keeps time.{" "}
          <span className="whitespace-nowrap">
            <ScribbleUnderline delay={0.9}>You</ScribbleUnderline> keep watch.
          </span>
        </AnimatedHeading>
        <RevealGroup as="ol" stagger={0.14} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {examSteps.map((step, index) => (
            <RevealItem
              as="li"
              kind="up"
              hover
              key={step.title}
              className={`flex min-h-64 flex-col rounded-[2rem] p-6 ${index === 2 ? "bg-charcoal text-paper" : "bg-panel"}`}
            >
              <span className="grid size-10 place-items-center rounded-full bg-highlighter font-semibold text-ink">
                {index + 1}
              </span>
              <h3 className="mt-12 text-xl font-medium tracking-tight">{step.title}</h3>
              <p className={`mt-2 text-[15px] leading-relaxed ${index === 2 ? "text-paper/65" : "text-graphite"}`}>
                {step.text}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

const universityPoints: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; text: string }[] = [
  { icon: Mail, title: "Invite by email", text: "University admins invite their lecturers; nobody signs up as staff on their own." },
  { icon: Building, title: "Every faculty, one place", text: "One platform and one login for every department and student." },
  { icon: ListChecks, title: "Numbers you can show", text: "Active students, time spent learning, assessments run, flags confirmed." },
  { icon: Shield, title: "Your data, your rules", text: "Georgian personal data law, an agreed retention period, nothing sold or shared." },
];

export function ForUniversities() {
  return (
    <section id="universities" className="scroll-mt-28 px-4 pb-24 sm:px-6 sm:pb-32">
      <Reveal kind="scale" amount={0.1} className="mx-auto max-w-[76rem] rounded-[2.5rem] bg-panel p-6 sm:p-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-end lg:gap-16">
          <div>
            <p className="-rotate-1 font-hand text-[1.7rem] leading-none text-graphite">For universities</p>
            <AnimatedHeading
              as="h2"
              className="mt-4 text-4xl font-medium leading-[1.02] tracking-[-0.04em] sm:text-5xl"
            >
              One platform for every faculty.
            </AnimatedHeading>
          </div>
          <p className="text-lg leading-relaxed text-graphite">
            Start with one course and one lecturer. When it works, every faculty joins the same
            platform, in Georgian, with clear evidence about learning and honesty.
          </p>
        </div>
        <RevealGroup stagger={0.12} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {universityPoints.map(({ icon: Icon, title, text }) => (
            <RevealItem key={title} hover className="rounded-[1.6rem] bg-card p-5">
              <span className="grid size-12 place-items-center rounded-full bg-panel">
                <Icon className="size-5" />
              </span>
              <p className="mt-7 text-lg font-medium">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-graphite">{text}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </Reveal>
    </section>
  );
}

export function StaffClosing() {
  return (
    <section className="px-4 py-28 sm:px-6 sm:py-36">
      <div className="mx-auto max-w-2xl text-center">
        <Reveal kind="pop" className="flex items-center justify-center gap-3">
          <Float amplitude={6} duration={3}>
            <Sparkle className="size-6" />
          </Float>
          <KalamiMark className="size-10" />
          <Float amplitude={6} duration={3} delay={1.2}>
            <Sparkle className="size-6" />
          </Float>
        </Reveal>
        <AnimatedHeading
          as="h2"
          className="mt-8 text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-7xl"
        >
          Run your next exam on Kalami.
        </AnimatedHeading>
        <Reveal as="p" delay={0.3} className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-graphite">
          A free pilot for one semester, set up with you. Already invited? Sign in and open your
          studio.
        </Reveal>
        <Reveal delay={0.45} className="mt-10 flex flex-wrap justify-center gap-3">
          <a href="mailto:hello@kalami.space" className={buttonClass("ink", "lg")}>
            Request a pilot
          </a>
          <ArrowLink href="/sign-in" tone="lime">
            Sign in
          </ArrowLink>
        </Reveal>
      </div>
    </section>
  );
}

export function StaffFooter() {
  return (
    <footer className="bg-charcoal px-4 pb-8 pt-14 text-paper sm:px-6">
      <div className="mx-auto max-w-[76rem]">
        <div className="flex flex-col gap-8 border-b border-paper/10 pb-10 md:flex-row md:items-center">
          <span className="flex items-center gap-3">
            <Logo tone="paper" />
            <span className="rounded-full bg-highlighter px-2.5 py-1 text-xs font-semibold text-ink">AntiCheat</span>
          </span>
          <span className="hidden h-8 border-l border-paper/15 md:block" />
          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-[15px] text-paper/60">
            <a href="#tools" className="hover:text-paper">Tools</a>
            <a href="#live" className="hover:text-paper">Live exams</a>
            <a href="#levels" className="hover:text-paper">Integrity levels</a>
            <a href="#universities" className="hover:text-paper">Universities</a>
            <a href={STUDENT_APP_URL} className="hover:text-paper">Student app</a>
            <Link href="/sign-in" className="hover:text-paper">Sign in</Link>
          </nav>
        </div>
        <div className="flex flex-col gap-2 pt-6 text-sm text-paper/45 sm:flex-row sm:justify-between">
          <p>© 2026 Kalami. Hard to cheat, easy to see.</p>
          <p>staff.kalami.space</p>
        </div>
      </div>
    </footer>
  );
}
