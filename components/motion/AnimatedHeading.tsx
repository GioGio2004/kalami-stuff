"use client";

import { motion, type Variants } from "motion/react";
import { Children, isValidElement, type ReactNode } from "react";
import { EASE } from "@/components/motion/Reveal";

const tags = { h1: motion.h1, h2: motion.h2, h3: motion.h3, p: motion.p } as const;

const word: Variants = {
  hidden: { opacity: 0, y: "0.55em", rotate: 3, filter: "blur(10px)" },
  show: {
    opacity: 1,
    y: 0,
    rotate: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: EASE },
  },
};

/** Words stay plain text; any element (a Scribble, a nowrap span) moves as one unit. */
function toUnits(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      for (const part of String(child).split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) {
          out.push(" ");
        } else {
          out.push(
            <motion.span key={key++} variants={word} className="inline-block">
              {part}
            </motion.span>,
          );
        }
      }
    } else if (isValidElement(child)) {
      out.push(
        <motion.span key={key++} variants={word} className="inline-block">
          {child}
        </motion.span>,
      );
    }
  });
  return out;
}

/** A heading whose words rise out of a blur, one after the other, when it scrolls in. */
export function AnimatedHeading({
  as = "h2",
  delay = 0,
  stagger = 0.055,
  className,
  children,
}: {
  as?: keyof typeof tags;
  delay?: number;
  stagger?: number;
  className?: string;
  children: ReactNode;
}) {
  const Component = tags[as];
  return (
    <Component
      className={className}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
    >
      {toUnits(children)}
    </Component>
  );
}
