"use client";

import { motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { fadeUp, spin, stagger } from "@/lib/motion";

/**
 * A full-screen wait, for anything that takes more than a moment: the swimming orca, a spinner, a
 * title and an optional line, on the ocean. Used while the student's courses load and while a dive
 * is prepared; `children` carries extra actions (e.g. "Cancel and try again"), `backHref` a back
 * button when there's somewhere to go back to.
 */
export function LoadingScreen({ title, message, eyebrow, backHref, part = "loading-screen", children }: {
  title: string;
  message?: string;
  eyebrow?: string;
  backHref?: string;
  /** `data-part` for tests. */
  part?: string;
  children?: React.ReactNode;
}) {
  return (
    <Screen bg="ocean">
      {backHref && (
        <header className="px-[28px] pt-[28px]">
          <BackButton href={backHref} />
        </header>
      )}
      <motion.div
        variants={stagger(0.06)}
        initial="hidden"
        animate="show"
        className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[28px] pb-[80px] text-center"
        data-part={part}
        aria-busy="true"
      >
        <motion.div variants={fadeUp}>
          <OrcaLogo width={110} swim shadow={false} />
        </motion.div>
        {eyebrow && (
          <motion.span variants={fadeUp} className="eyebrow">
            {eyebrow}
          </motion.span>
        )}
        <motion.span aria-hidden className="h-[36px] w-[36px] rounded-pill border-[4px] border-alice border-t-wisteria-deep" animate={spin} />
        <motion.h1 variants={fadeUp} className="text-[34px] font-bold leading-tight text-prussian" role="status">
          {title}
        </motion.h1>
        {message && (
          <motion.p variants={fadeUp} className="max-w-[520px] text-[15px] font-medium text-prussian">
            {message}
          </motion.p>
        )}
        {children}
      </motion.div>
    </Screen>
  );
}
