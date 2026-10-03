"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A stroke that draws itself once, when it scrolls into view. */
export function DrawPath({
  d,
  stroke,
  strokeWidth,
  delay = 0,
  duration = 1.1,
  className,
}: {
  d: string;
  stroke: string;
  strokeWidth: number;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  return (
    <motion.path
      d={d}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      initial={{ pathLength: 0 }}
      whileInView={{ pathLength: 1 }}
      viewport={{ once: true, amount: "some" }}
      transition={{ duration, delay, ease: [0.65, 0, 0.35, 1] }}
    />
  );
}

/** Counts from 0 up to `to` when it scrolls into view. */
export function CountUp({
  to,
  duration = 1.4,
  delay = 0,
  className,
}: {
  to: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const rounded = useTransform(value, (latest) => Math.round(latest));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      value.set(to);
      return;
    }
    const controls = animate(value, to, { duration, delay, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, reduce, to, duration, delay, value]);

  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}

/** A progress bar that fills like ink when it scrolls into view. */
export function Bar({
  percent,
  delay = 0,
  className = "",
  fillClassName = "bg-ink",
}: {
  percent: number;
  delay?: number;
  className?: string;
  fillClassName?: string;
}) {
  return (
    <div className={className}>
      <motion.div
        className={`h-full rounded-full ${fillClassName}`}
        initial={{ width: 0 }}
        whileInView={{ width: `${percent}%` }}
        viewport={{ once: true, amount: "some" }}
        transition={{ duration: 1.2, delay, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

/** Drifts up and down forever, a little different for every card. */
export function Float({
  amplitude = 10,
  rotate = 0,
  duration = 6,
  delay = 0,
  className,
  children,
}: {
  amplitude?: number;
  rotate?: number;
  duration?: number;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -amplitude, 0], ...(rotate ? { rotate: [-rotate, rotate, -rotate] } : {}) }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

/** Moves its content at a different speed from the page while it passes through. */
export function Parallax({
  from = 40,
  to = -40,
  className,
  children,
}: {
  from?: number;
  to?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [from, to]);
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

/** A thin bar along the top that fills as the page is read. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-1 origin-left bg-highlighter-deep"
    />
  );
}

/** A number that keeps going up, like a live timer. */
export function Ticker({ start, every = 1000, suffix = "" }: { start: number; every?: number; suffix?: string }) {
  const [value, setValue] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setValue((current) => current + 1), every);
    return () => clearInterval(id);
  }, [every]);
  return (
    <span className="tabular-nums">
      {value}
      {suffix}
    </span>
  );
}

/** The red pen stroke through a crossed-out icon, drawn when it scrolls in. */
export function Strike() {
  return (
    <motion.span
      aria-hidden
      className="absolute h-[2px] w-9 rotate-45 rounded-full bg-red-pen"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, amount: "some" }}
      transition={{ duration: 0.5, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}
