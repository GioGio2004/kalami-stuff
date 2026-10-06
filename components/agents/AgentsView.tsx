"use client";

import { Check, Shield } from "@/components/ui/icons";
import { useOrigin } from "@/lib/useOrigin";
import { ConnectSnippets } from "./ConnectSnippets";

const EXAMPLE_PROMPTS = [
  "Turn my syllabus into weeks for “Web basics”, with a lesson and a quiz each.",
  "Write a lesson on CSS selectors for Week 3, with examples and a quick check.",
  "Make a presentation for Week 2 on how the web works, about 12 slides, in the Aurora theme.",
  "Draft a 10-question quiz on CSS selectors for “Web basics”, in Georgian.",
  "Create a midterm for “Web basics” with 20 questions covering weeks 1 to 6.",
  "List my courses and tell me which ones have no final yet.",
  "Review the questions in my midterm and fix any that are ambiguous.",
];

/** How to connect an MCP client. Each lecturer signs in with their own account; there is nothing to manage here. */
export function AgentsView() {
  const origin = useOrigin();

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="max-w-3xl px-1">
        <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Your assistant, your rules</p>
        <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">Connect an agent</h1>
        <p className="mt-5 text-lg leading-relaxed text-graphite">
          Kalami is an MCP server. Add it to your own AI assistant, sign in with your Kalami account, and it can draft
          courses, weekly lessons, presentations, quizzes and exams as you. It can’t publish, and it never sees students.
        </p>
      </div>

      <div className="mt-10 grid gap-4 *:min-w-0 lg:grid-cols-12">
        <section className="notch-top rounded-[2rem] bg-card p-6 pt-8 sm:p-8 sm:pt-10 lg:col-span-7">
          <StepHeading n={1} title="Add Kalami to your agent" />
          <p className="mt-2 text-[15px] leading-relaxed text-graphite">
            Pick the AI app you use and follow its steps. It asks you to sign in to Kalami once; use the account you
            teach with.
          </p>
          <div className="mt-5">
            <ConnectSnippets origin={origin} />
          </div>
        </section>

        <section className="rounded-[2rem] bg-charcoal p-6 text-paper sm:p-8 lg:col-span-5">
          <span className="grid size-12 place-items-center rounded-full bg-charcoal-soft text-paper">
            <Shield className="size-5" />
          </span>
          <h2 className="mt-8 text-2xl font-medium tracking-tight">What an agent can and can’t do</h2>
          <ul className="mt-5 space-y-3 text-[15px]">
            {[
              ["Can", "list and create courses, quizzes, midterms and finals you own"],
              ["Can", "plan draft weeks, write lessons in them, add links, and put tasks and quizzes in a week"],
              ["Can", "build animated presentations in a week: typed slides in one of five themes"],
              ["Can", "add, edit, delete and reorder questions in drafts, with answer keys"],
              ["Can’t", "publish anything: assessments, weeks, lessons and presentations wait for you"],
              ["Can’t", "change a week, lesson, presentation or assessment once it’s published, or create Drive folders"],
              ["Can’t", "see students, attempts, grades or integrity flags"],
              ["Can’t", "touch courses you only assist on"],
            ].map(([verb, what]) => (
              <li key={what} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${verb === "Can" ? "bg-highlighter text-ink" : "bg-paper/15 text-paper"}`}>
                  {verb}
                </span>
                <span className="text-paper/80">{what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-paper/55">
            “Assist on” means a course someone else owns where you were added as a helper; agents only work on courses
            you can edit. Every change an agent makes is written to the course history with a robot icon. To cut an
            agent off, disconnect Kalami in that app’s settings.
          </p>
        </section>

        <section className="rounded-[2rem] bg-highlighter p-6 sm:p-8 lg:col-span-12">
          <StepHeading n={2} title="Ask for a draft" dark />
          <p className="mt-2 text-[15px] leading-relaxed text-ink/75">
            Your agent will call <code className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-xs">whoami</code> first,
            then work through your courses. Try:
          </p>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt} className="flex items-start gap-2.5 rounded-2xl bg-paper/70 px-4 py-2.5 text-sm leading-snug">
                <Check className="mt-0.5 size-4 shrink-0" />
                {prompt}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-ink/75">
            Everything it makes is a draft. When it’s done it gives you a link: open it, check the lessons, questions
            and answer keys, then press Publish yourself.
          </p>
        </section>
      </div>
    </div>
  );
}

function StepHeading({ n, title, dark = false }: { n: number; title: string; dark?: boolean }) {
  return (
    <h2 className="flex items-center gap-3 text-2xl font-medium tracking-tight">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${dark ? "bg-ink text-highlighter" : "bg-highlighter text-ink"}`}>
        {n}
      </span>
      {title}
    </h2>
  );
}
