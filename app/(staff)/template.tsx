"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/** A template remounts on every navigation, so each page fades in. */
export default function StaffTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      {children}
    </motion.div>
  );
}
