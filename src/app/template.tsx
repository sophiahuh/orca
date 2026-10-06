"use client";

import { motion } from "motion/react";
import { page } from "@/lib/motion";

/** Route transition: every page fades/slides in with the shared `page` preset. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={page} initial="hidden" animate="show" className="flex flex-1 flex-col">
      {children}
    </motion.div>
  );
}
