"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Island } from "@/components/brand/Island";
import { Wave } from "@/components/brand/Decor";
import { LabelPill } from "@/components/map/LabelPill";
import { fadeUp, popIn, stagger } from "@/lib/motion";

export default function NewCoursePage() {
  const router = useRouter();
  const { addCourse } = useOrca();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const create = () => {
    if (!trimmed) return;
    addCourse(trimmed);
    router.push("/");
  };

  return (
    <Screen bg="ocean">
      <header className="px-[28px] pt-[28px]">
        <BackButton />
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="relative flex flex-1"
      >
        <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="z-10 flex w-[560px] max-w-full flex-col px-[72px] pb-[48px] pt-[72px] lg:px-[100px]">
          <motion.span variants={fadeUp} className="eyebrow">
            New island
          </motion.span>
          <motion.h1 variants={fadeUp} className="mt-[14px] text-[54px] font-bold leading-[1.05] text-prussian">
            What are you
            <br />
            studying?
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-[22px] max-w-[400px] text-[17px] leading-[1.45] text-prussian">
            Every class becomes an island you can explore and grow.
          </motion.p>

          <motion.label variants={fadeUp} className="mt-[40px] flex flex-col gap-[10px]">
            <span className="text-[14px] font-semibold text-wisteria-deep">Course Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Advanced Logic Design"
              className="h-[68px] w-[440px] max-w-full rounded-[24px] border-[3.5px] border-wisteria bg-parchment px-[22px] text-[24px] font-semibold text-prussian lip-5 lip-periwinkle placeholder:font-medium placeholder:text-alice-deep focus:border-wisteria-deep focus:outline-none"
            />
          </motion.label>

          <motion.div variants={fadeUp} className="mt-[26px] flex items-center gap-[14px]">
            <Button type="submit" disabled={!trimmed}>
              Create Course
            </Button>
            <Button variant="secondary" onClick={() => router.push("/")}>
              Cancel
            </Button>
          </motion.div>
        </motion.div>

        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[620px] md:block" aria-hidden>
          <Wave tone="light" x={20} y={120} width={70} seed={1} />
          <Wave tone="light" x={80} y={620} width={60} seed={2} />
          <motion.div variants={popIn} initial="hidden" animate="show" className="absolute" style={{ left: 60, top: 150 }}>
            <Island variant="ald" level="growing" scale={2.1} float seed={2} />
            <div className="absolute left-[294px] -translate-x-1/2" style={{ top: 420 }}>
              <LabelPill interactive={false} className="text-[16px]">
                {trimmed || "Your course"}
              </LabelPill>
            </div>
          </motion.div>
        </div>
      </form>
    </Screen>
  );
}
