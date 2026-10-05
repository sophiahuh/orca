"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/layout/Screen";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Island } from "@/components/brand/Island";
import { Bubble, Wave } from "@/components/brand/Decor";
import { useOrca } from "@/lib/store";
import { fadeUp, popIn, stagger } from "@/lib/motion";

const ISLANDS = [
  { x: 20, y: 120, variant: "ald", level: "thriving", scale: 0.78 },
  { x: 330, y: 220, variant: "circuit", level: "growing", scale: 0.78 },
  { x: 10, y: 410, variant: "linear", level: "sprouting", scale: 0.72 },
  { x: 250, y: 560, variant: "signals", level: "uncharted", scale: 0.78 },
  { x: 560, y: 470, variant: "stats", level: "uncharted", scale: 0.7 },
] as const;

const BUBBLES = [
  { x: 190, y: 90, s: 18 },
  { x: 650, y: 60, s: 10 },
  { x: 700, y: 170, s: 12 },
  { x: 290, y: 345, s: 10 },
  { x: 560, y: 620, s: 22 },
  { x: 150, y: 680, s: 8 },
  { x: 720, y: 720, s: 14 },
];

export default function OnboardingPage({ searchParams }: PageProps<"/">) {
  const sp = use(searchParams);
  const router = useRouter();
  const { setOnboarded, onboarded, hydrated } = useOrca();
  const preview = sp.preview !== undefined;

  // Returning students land on the map; `/?preview` always shows this screen.
  useEffect(() => {
    if (hydrated && onboarded && !preview) router.replace("/home");
  }, [hydrated, onboarded, preview, router]);

  const go = () => {
    setOnboarded(true);
    router.push("/home");
  };

  return (
    <Screen bg="alice">
      <motion.div
        variants={stagger(0.1, 0.09)}
        initial="hidden"
        animate="show"
        className="relative z-10 flex max-w-[560px] flex-col px-[72px] pb-[56px] pt-[80px] lg:px-[100px]"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-[10px]">
          <OrcaLogo width={56} shadow={false} />
          <span className="text-[24px] font-bold text-prussian">Orca</span>
        </motion.div>

        <motion.h1 variants={fadeUp} className="mt-[40px] text-[68px] font-bold leading-[1.0] tracking-[-1px] text-prussian">
          Mastery
          <br />
          Made
          <br />
          Easy.
        </motion.h1>

        <motion.p variants={fadeUp} className="mt-[32px] max-w-[420px] text-[17px] leading-[1.45] text-prussian">
          Turn every class into an island. Explore it in quick, calm sessions that fit around your week.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-[40px] flex w-[340px] flex-col gap-[14px]">
          <Button onClick={go}>Get started</Button>
          <Button variant="secondary" onClick={go}>
            I already have an account
          </Button>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-[64px] flex items-center gap-[8px]" aria-hidden>
          <span className="h-[8px] w-[26px] rounded-pill bg-wisteria" />
          <span className="h-[8px] w-[8px] rounded-pill bg-alice-deep" />
          <span className="h-[8px] w-[8px] rounded-pill bg-alice-deep" />
        </motion.div>
      </motion.div>

      {/* Decorative archipelago, anchored to the right edge. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[800px] md:block"
        variants={stagger(0.2, 0.1)}
        initial="hidden"
        animate="show"
      >
        <Wave tone="light" x={-40} y={290} width={70} seed={1} />
        <Wave tone="light" x={420} y={420} width={60} seed={2} />
        <Wave tone="light" x={120} y={760} width={80} seed={3} />
        {BUBBLES.map((b, i) => (
          <Bubble key={i} x={b.x} y={b.y} size={b.s} seed={i} />
        ))}
        {ISLANDS.map((isl, i) => (
          <motion.div key={i} variants={popIn} className="absolute" style={{ left: isl.x, top: isl.y }}>
            <Island variant={isl.variant} level={isl.level} scale={isl.scale} float seed={i} />
          </motion.div>
        ))}
      </motion.div>
    </Screen>
  );
}
