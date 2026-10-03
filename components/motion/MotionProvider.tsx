"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** "user" turns off movement (not fades) for people who asked for reduced motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
