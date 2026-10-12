import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";

/** Main area + the 340px right sidebar. Used by the map and path screens. */
export function AppShell({ bg = "parchment", className, children }: { bg?: "parchment" | "ocean"; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen-below-bar w-full overflow-hidden">
      <main className={cn("relative min-w-0 flex-1 overflow-hidden", bg === "parchment" ? "bg-parchment" : "bg-ocean", className)}>
        {children}
      </main>
      <Sidebar />
    </div>
  );
}
