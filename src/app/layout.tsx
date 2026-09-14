import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";
import { ThemeScript } from "./components/shell/theme-script";

// Archivo (with its width axis) carries every Latin glyph — UI text at normal width, the wordmark
// and big figures set wide. Martian Mono only ever sets numbers, ids and timestamps. Chinese falls
// through to the platform's CJK face (PingFang / YaHei / Noto), which is what real Chinese
// products do too.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-martian",
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
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

// The root layout only sets up fonts, theme and providers. The signed-in shell (sidebar,
// overview polling) lives in (app)/layout.tsx; the sign-in pages in (auth)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${archivo.variable} ${martian.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
