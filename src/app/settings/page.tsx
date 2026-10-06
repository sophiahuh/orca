"use client";

import { motion } from "motion/react";
import { useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Card } from "@/components/ui/Card";
import { ConfigRow, REVIEW_LABELS } from "@/components/config/ConfigRow";
import { WeightsEditor } from "@/components/config/WeightsEditor";
import { AccountCard } from "@/components/settings/Account";
import { YourMetricsCard } from "@/components/settings/YourMetrics";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * Settings: account-wide fallbacks. A course can inherit these live defaults or set a higher-
 * priority override from that course's own settings popup (ClassConfigModal).
 */
export default function SettingsPage() {
  const { defaultConfig, defaultWeights, setDefaults, hydrated } = useOrca();

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <h1 className="text-[46px] font-bold leading-none text-prussian">Configurations</h1>
      </header>

      <div className="flex flex-wrap items-start gap-[24px] px-[40px] pb-[48px] pt-[36px]">
        {/* Only once loaded: an edit made before the load lands would be overwritten on screen by it. */}
        {hydrated && (
        <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex w-[640px] max-w-full flex-col gap-[24px]">
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[18px] px-[28px] pb-[28px] pt-[24px]" data-part="default-config">
              <div className="flex flex-col gap-[4px]">
                <h2 className="text-[22px] font-bold text-prussian">Default Review Settings</h2>
                <p className="text-[14px] font-medium text-wisteria-deep">Used by every course unless overridden by that course&apos;s own configurations.</p>
              </div>
              <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[14px]">
                {(["quick", "deep", "exam"] as const).map((k) => (
                  <ConfigRow key={k} label={REVIEW_LABELS[k]} row={defaultConfig[k]} onChange={(row) => setDefaults({ ...defaultConfig, [k]: row }, defaultWeights)} />
                ))}
              </motion.div>
            </Card>
          </motion.div>
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[16px] px-[28px] pb-[24px] pt-[24px]">
              <div className="flex flex-col gap-[4px]">
                <h2 className="text-[22px] font-bold text-prussian">Account weights</h2>
                <p className="text-[14px] font-medium text-wisteria-deep">What Orca prioritizes unless a course overrides its own weights.</p>
              </div>
              <WeightsEditor weights={defaultWeights} onChange={(w) => setDefaults(defaultConfig, w)} />
            </Card>
          </motion.div>
        </motion.div>
        )}

        <motion.div variants={stagger(0.1, 0.08)} initial="hidden" animate="show" className="flex w-[418px] max-w-full flex-col gap-[24px]">
          <motion.div variants={fadeUp}>
            <AccountCard />
          </motion.div>
          <motion.div variants={fadeUp}>
            <YourMetricsCard />
          </motion.div>
          {/* "Your AI" (src/components/settings/YourAI.tsx) is hidden: model calls run on the server with
              Orca's key only (Phase 4, decision 9). Its code stays until "Bring-your-own model" is decided. */}
        </motion.div>
      </div>
    </Screen>
  );
}
