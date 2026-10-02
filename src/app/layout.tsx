import type { Metadata } from "next";
import { Gabarito } from "next/font/google";
import "./globals.css";
import { OrcaProvider } from "@/lib/store";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${gabarito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <OrcaProvider>{children}</OrcaProvider>
      </body>
    </html>
  );
}
