"use client";

import { motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatBubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className={cn("flex w-full items-end gap-[10px]", mine ? "justify-end" : "justify-start")}>
      {!mine && <OrcaLogo width={40} shadow={false} className="mb-[2px] shrink-0" />}
      <div
        className={cn(
          "max-w-[620px] whitespace-pre-wrap rounded-[22px] px-[18px] py-[12px] text-[16px] leading-relaxed",
          mine
            ? "rounded-br-[8px] bg-wisteria text-parchment lip-3 lip-wisteria"
            : "rounded-bl-[8px] border-2 border-alice-deep bg-parchment text-prussian lip-3 lip-alice",
        )}
      >
        {message.content}
      </div>
    </motion.div>
  );
}

/** Three bobbing dots while Orca thinks. */
export function Typing() {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" exit="exit" className="flex items-end gap-[10px]">
      <OrcaLogo width={40} shadow={false} swim className="shrink-0" />
      <div className="flex items-center gap-[6px] rounded-[22px] rounded-bl-[8px] border-2 border-alice-deep bg-parchment px-[18px] py-[16px] lip-3 lip-alice">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-[8px] w-[8px] rounded-pill bg-periwinkle-deep"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
    </motion.div>
  );
}
