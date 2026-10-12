import type { ReactNode } from "react";
import { Screen } from "@/components/layout/Screen";

/**
 * The frame of every account screen (Figma: 12 · Log in, 13 · Sign up): the form on the left
 * (an eyebrow, a big title, a line under it) and an aside on the right (an island, or the avatar
 * picker). The top bar above is the app's, showing only the avatar here.
 */
export function AuthShell({ eyebrow, title, lead, aside, children }: { eyebrow: string; title: string; lead?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Screen bg="alice" className="overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1194px] flex-1 flex-col gap-[40px] px-[24px] py-[48px] md:flex-row md:items-center md:gap-[40px] md:px-[120px] md:py-[64px]">
        <section className="flex w-full max-w-[520px] flex-col gap-[24px]">
          <div className="flex flex-col gap-[10px]">
            <span className="eyebrow">{eyebrow}</span>
            <h1 className="text-[44px] font-bold leading-[1.1] text-prussian md:text-[54px]">{title}</h1>
            {lead && <p className="text-[20px] text-prussian">{lead}</p>}
          </div>
          {children}
        </section>
        {aside && (
          <aside className="flex flex-1 items-center justify-center" aria-hidden={false}>
            {aside}
          </aside>
        )}
      </div>
    </Screen>
  );
}
