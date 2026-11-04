import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { connection } from "next/server";
import { NotConnected } from "@/components/auth/NotConnected";
import { SupabaseNotConfiguredError, publicSupabaseEnv } from "@/lib/supabase/env";
import { Providers } from "./providers";

// Gabarito is served from the repo (the @fontsource-variable package, OFL), not fetched from Google
// Fonts at build time: that fetch failed on the CI runner twice on 2026-11-04 and blocked deploys.
const gabarito = localFont({
  src: "../../node_modules/@fontsource-variable/gabarito/files/gabarito-latin-wght-normal.woff2",
  variable: "--font-gabarito",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orca · Mastery made easy",
  description:
    "Turn every class into an island. Explore it in quick, calm sessions that fit around your week.",
};

/** Without Supabase's environment variables the app says so instead of opening (no local fallback). */
function connectionProblem(): string | null {
  try {
    publicSupabaseEnv();
    return null;
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return e.message;
    throw e;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection(); // read the environment per request, never baked into a static page
  const problem = connectionProblem();
  return (
    <html lang="en" className={`${gabarito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {problem ? <NotConnected message={problem} /> : <Providers>{children}</Providers>}
      </body>
    </html>
  );
}
