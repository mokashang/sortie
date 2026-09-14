import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";
import { ThemeScript } from "./components/shell/theme-script";
import { HTML_LANG } from "@/i18n/lang";
import { getLang, getMessages } from "@/i18n/server";

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

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: { default: "Sortie", template: "%s · Sortie" },
    description: m.shell.appDescription,
    applicationName: "Sortie",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

// The root layout only sets up fonts, theme, language and providers. The signed-in shell
// (topbar, overview polling) lives in (app)/layout.tsx; the sign-in pages in (auth)/layout.tsx.
// The UI language comes from the sortie.lang cookie (falling back to the saved preference), so
// the server renders every page in the chosen language and the client picks it up from context.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={HTML_LANG[lang]} className={`${archivo.variable} ${martian.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
