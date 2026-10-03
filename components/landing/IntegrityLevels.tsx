import { DrawPath } from "@/components/motion/primitives";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Sparkle } from "@/components/ui/icons";
import { CircledLabel, Scribble } from "@/components/ui/Scribble";
import { SectionHeading } from "@/components/ui/SectionHeading";

const levels = [
  {
    name: "Practice",
    key: "off",
    dark: false,
    useFor: "Homework",
    items: [
      "No paste, drop or right-click in the editor",
      "No autocomplete",
      "Copy, print and devtools shortcuts blocked",
    ],
  },
  {
    name: "Standard",
    key: "standard",
    dark: true,
    useFor: "Quizzes",
    items: [
      "Everything in Practice",
      "Watermark with the student's name",
      "Tab, focus and time-away tracking",
      "One tab and one session at a time",
      "Typing anomaly detection",
    ],
  },
  {
    name: "Strict",
    key: "strict",
    dark: false,
    useFor: "Exams",
    items: [
      "Everything in Standard",
      "Fullscreen required, every exit logged",
      "Content hidden when the window loses focus",
      "Auto-lock after limits; only staff can unlock",
    ],
  },
];

export function IntegrityLevels() {
  return (
    <section id="levels" className="scroll-mt-28 px-4 pb-24 sm:px-6 sm:pb-32">
      <div className="relative mx-auto max-w-[76rem]">
        <svg
          aria-hidden
          viewBox="0 0 320 240"
          className="pointer-events-none absolute -top-10 right-0 hidden w-80 lg:block"
        >
          <DrawPath
            duration={1.8}
            d="M8 200c60-36 140-40 196-12 40 20 62 4 58-34-5-46-52-80-92-62-36 16-30 74 14 96 50 25 104 6 128-28"
            stroke="var(--highlighter-deep)"
            strokeWidth={2.5}
          />
        </svg>
        <Reveal kind="left">
          <CircledLabel>Integrity levels</CircledLabel>
        </Reveal>
        <SectionHeading>Choose how strict each assessment is.</SectionHeading>

        <RevealGroup stagger={0.16} className="mt-14 grid gap-5 lg:grid-cols-3">
          {levels.map((level) => (
            <RevealItem
              as="article"
              kind="up"
              hover
              key={level.key}
              className={`notch-sides flex min-h-[32rem] flex-col rounded-[2rem] [--notch-y:calc(100%_-_9.5rem)] ${
                level.dark ? "bg-charcoal text-paper" : "bg-panel text-ink"
              }`}
            >
              <div className="flex-1 p-8 pb-6">
                <h3 className="text-2xl font-medium tracking-tight">{level.name}</h3>
                <p className="mt-1 font-mono text-xs opacity-50">integrityLevel: &quot;{level.key}&quot;</p>
                <RevealGroup as="ul" stagger={0.1} delay={0.35} className="mt-7 space-y-3.5">
                  {level.items.map((item) => (
                    <RevealItem as="li" kind="left" key={item} className="flex gap-3 text-[15px] leading-snug">
                      <Sparkle className="mt-0.5 size-4 shrink-0" />
                      {item}
                    </RevealItem>
                  ))}
                </RevealGroup>
              </div>
              <div
                className={`flex h-[9.5rem] flex-col justify-center border-t border-dashed px-8 ${
                  level.dark ? "border-paper/20" : "border-ink/15"
                }`}
              >
                <p className="text-sm opacity-60">Use it for</p>
                {level.dark ? (
                  <div className="relative mt-1 w-fit">
                    <p className="text-5xl font-medium tracking-[-0.04em]">
                      <Scribble delay={0.9}>{level.useFor}</Scribble>
                    </p>
                    <Reveal
                      as="span"
                      kind="pop"
                      delay={1.2}
                      className="absolute -right-24 -top-7 rotate-12 font-hand text-2xl text-highlighter"
                    >
                      Most used!
                    </Reveal>
                  </div>
                ) : (
                  <p className="mt-1 text-5xl font-medium tracking-[-0.04em]">{level.useFor}</p>
                )}
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
