import type { ReactNode } from "react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";

/** The frame of every account screen: the orca, a parchment card, a title and a line under it. */
export function AuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <Screen bg="alice" className="items-center justify-center px-[16px] py-[40px]">
      <div className="flex items-center gap-[10px]">
        <OrcaLogo width={56} shadow={false} />
        <span className="text-[24px] font-bold text-prussian">Orca</span>
      </div>
      <Card className="mt-[28px] flex w-[440px] max-w-full flex-col gap-[18px] px-[32px] pb-[32px] pt-[28px]">
        <div>
          <h1 className="text-[28px] font-semibold text-prussian">{title}</h1>
          {lead && <p className="mt-[6px] text-[15px] text-wisteria-deep">{lead}</p>}
        </div>
        {children}
      </Card>
    </Screen>
  );
}
