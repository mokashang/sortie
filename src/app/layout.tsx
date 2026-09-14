import type { Metadata, Viewport } from "next";
import { Newsreader, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";
import { ThemeScript } from "./components/shell/theme-script";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Sortie", template: "%s · Sortie" },
  description: "Sortie — 你的求职助手:找岗、匹配、投递、内推、追踪,一处搞定。",
  applicationName: "Sortie",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#171410" },
  ],
};

// The root layout only sets up fonts, theme and providers. The signed-in shell (sidebar,
// overview polling) lives in (app)/layout.tsx; the sign-in pages in (auth)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${newsreader.variable} ${plexSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
