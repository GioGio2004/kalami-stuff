import type { ReactNode } from "react";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <AnimatedHeading
      as="h2"
      className="mt-5 max-w-3xl text-4xl font-medium leading-[1.02] tracking-[-0.04em] sm:text-6xl"
    >
      {children}
    </AnimatedHeading>
  );
}
