"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

const tags = {
  div: motion.div,
  article: motion.article,
  section: motion.section,
  header: motion.header,
  h1: motion.h1,
  li: motion.li,
  ul: motion.ul,
  ol: motion.ol,
  p: motion.p,
  span: motion.span,
  h2: motion.h2,
  h3: motion.h3,
} as const;

type Tag = keyof typeof tags;
export type Kind = "up" | "left" | "right" | "scale" | "pop" | "drop";

const ease = (delay: number) => ({ duration: 0.85, ease: EASE, delay });

/** What an element does on its way in. `delay` is only used by standalone Reveals. */
export function itemVariants(kind: Kind, delay = 0): Variants {
  switch (kind) {
    case "left":
      return { hidden: { opacity: 0, x: -56 }, show: { opacity: 1, x: 0, transition: ease(delay) } };
    case "right":
      return { hidden: { opacity: 0, x: 56 }, show: { opacity: 1, x: 0, transition: ease(delay) } };
    case "drop":
      return { hidden: { opacity: 0, y: -40 }, show: { opacity: 1, y: 0, transition: ease(delay) } };
    case "scale":
      return {
        hidden: { opacity: 0, scale: 0.9, y: 24 },
        show: { opacity: 1, scale: 1, y: 0, transition: ease(delay) },
      };
    case "pop":
      return {
        hidden: { opacity: 0, scale: 0.3, rotate: -14 },
        show: {
          opacity: 1,
          scale: 1,
          rotate: 0,
          transition: { type: "spring", stiffness: 360, damping: 16, delay },
        },
      };
    default:
      return { hidden: { opacity: 0, y: 44 }, show: { opacity: 1, y: 0, transition: ease(delay) } };
  }
}

const viewport = (amount: number) => ({ once: true, amount, margin: "0px 0px -60px 0px" });

type Common = { as?: Tag; className?: string; children?: ReactNode };

/** Animates in once, when it scrolls into view. */
export function Reveal({
  as = "div",
  kind = "up",
  delay = 0,
  amount = 0.2,
  className,
  children,
}: Common & { kind?: Kind; delay?: number; amount?: number }) {
  const Component = tags[as] as typeof motion.div;
  return (
    <Component
      className={className}
      variants={itemVariants(kind, delay)}
      initial="hidden"
      whileInView="show"
      viewport={viewport(amount)}
    >
      {children}
    </Component>
  );
}

/** Staggers its RevealItem descendants as the group scrolls into view. */
export function RevealGroup({
  as = "div",
  stagger = 0.09,
  delay = 0,
  amount = 0.15,
  className,
  children,
}: Common & { stagger?: number; delay?: number; amount?: number }) {
  const Component = tags[as] as typeof motion.div;
  return (
    <Component
      className={className}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
      initial="hidden"
      whileInView="show"
      viewport={viewport(amount)}
    >
      {children}
    </Component>
  );
}

export function RevealItem({
  as = "div",
  kind = "up",
  hover = false,
  className,
  children,
}: Common & { kind?: Kind; hover?: boolean }) {
  const Component = tags[as] as typeof motion.div;
  return (
    <Component
      className={className}
      variants={itemVariants(kind)}
      whileHover={hover ? { y: -8, transition: { type: "spring", stiffness: 320, damping: 18 } } : undefined}
    >
      {children}
    </Component>
  );
}

/** Animates on mount instead of on scroll: headers, gates, anything above the fold. */
export function Enter({
  as = "div",
  kind = "up",
  delay = 0,
  className,
  children,
}: Common & { kind?: Kind; delay?: number }) {
  const Component = tags[as] as typeof motion.div;
  return (
    <Component
      className={className}
      variants={itemVariants(kind, delay)}
      initial="hidden"
      animate="show"
    >
      {children}
    </Component>
  );
}
