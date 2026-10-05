"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/** A template remounts on every navigation, so each admin page fades in. */
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }} className="space-y-4">
      {children}
    </motion.div>
  );
}
