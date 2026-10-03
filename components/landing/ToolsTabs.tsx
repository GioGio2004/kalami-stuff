"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";

export type Tool = {
  id: string;
  label: string;
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
  mock: ReactNode;
};

/** Pill tabs over one notched panel (the Tabela "features" pattern). */
export function ToolsTabs({ tools, heading }: { tools: Tool[]; heading: ReactNode }) {
  const [activeId, setActiveId] = useState(tools[0].id);
  const active = tools.find((tool) => tool.id === activeId) ?? tools[0];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        {heading}
        <div role="tablist" aria-label="Staff tools" className="flex flex-wrap gap-2">
          {tools.map((tool) => {
            const selected = tool.id === active.id;
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                id={`tab-${tool.id}`}
                aria-selected={selected}
                aria-controls="tools-panel"
                onClick={() => setActiveId(tool.id)}
                className={`relative flex items-center gap-2 rounded-full px-4 py-2.5 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected ? "text-paper" : "bg-panel text-graphite hover:text-ink"
                }`}
              >
                {selected && (
                  <motion.span
                    layoutId="tools-tab"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  {tool.icon}
                  {tool.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={active.id}
          id="tools-panel"
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, y: -16, transition: { duration: 0.18 } }}
          className="notch-top mt-8 grid gap-8 rounded-[2.5rem] bg-panel p-5 *:min-w-0 sm:p-10 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:p-14"
        >
          <div className="rounded-[2rem] bg-card p-4 shadow-[0_30px_60px_-40px_rgba(20,20,20,0.5)] sm:p-6">{active.mock}</div>
          <div>
            <h3 className="text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl">{active.title}</h3>
            <p className="mt-4 text-lg leading-relaxed text-graphite">{active.body}</p>
            <RevealGroup as="ul" stagger={0.1} delay={0.25} className="mt-6 space-y-3">
              {active.points.map((point) => (
                <RevealItem as="li" kind="left" key={point} className="flex items-start gap-3 text-[15px] leading-snug">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-highlighter-deep" />
                  {point}
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
