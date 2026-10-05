import type { Metadata } from "next";
import { Gabarito } from "next/font/google";
import "./globals.css";
import { connection } from "next/server";
import { NotConnected } from "@/components/auth/NotConnected";
import { SupabaseNotConfiguredError, publicSupabaseEnv } from "@/lib/supabase/env";
import { Providers } from "./providers";

const gabarito = Gabarito({
  variable: "--font-gabarito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
