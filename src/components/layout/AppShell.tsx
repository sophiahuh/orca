import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";

/** Main area + the 340px right sidebar. Used by the map and path screens. */
export function AppShell({ bg = "parchment", className, children }: { bg?: "parchment" | "alice"; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <main className={cn("relative min-w-0 flex-1 overflow-hidden", bg === "parchment" ? "bg-parchment" : "bg-alice", className)}>
        {children}
      </main>
      <Sidebar />
    </div>
  );
}
