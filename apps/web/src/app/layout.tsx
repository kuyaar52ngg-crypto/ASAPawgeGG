import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { GsapProvider } from "@/components/providers/gsap-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@/components/analytics";
import { SupportChat } from "@/components/support-chat";

// Self-hosted variable fonts (cyrillic + latin subsets) — no build-time network access to Google needed.
const manrope = localFont({
  src: [
    { path: "../fonts/manrope-cyrillic-wght-normal.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/manrope-latin-wght-normal.woff2", weight: "200 800", style: "normal" },
  ],
  variable: "--font-manrope",
  display: "swap",
});
const unbounded = localFont({
  src: [
    { path: "../fonts/unbounded-cyrillic-wght-normal.woff2", weight: "200 900", style: "normal" },
    { path: "../fonts/unbounded-latin-wght-normal.woff2", weight: "200 900", style: "normal" },
  ],
  variable: "--font-unbounded",
  display: "swap",
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "ASAPawge GG — маркетплейс игр, подписок и пополнения Steam", template: "%s · ASAPawge GG" },
  description: "Ключи игр, подписки (Spotify, Netflix, ChatGPT, Game Pass, PS Plus), пополнение Steam, подарочные карты и игровая валюта. Мгновенная выдача 24/7.",
  applicationName: "ASAPawge GG",
  openGraph: { type: "website", siteName: "ASAPawge GG", locale: "ru_RU" },
};

export const viewport: Viewport = {
  themeColor: "#070914",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`dark ${manrope.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <GsapProvider>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            </GsapProvider>
          </QueryProvider>
          <Toaster />
          <Analytics />
          <SupportChat />
        </ThemeProvider>
      </body>
    </html>
  );
}
