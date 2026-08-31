import { Newsreader, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { NavLinks } from "./nav-links";

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

export const metadata = { title: "JobSeeker OS" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${newsreader.variable} ${plexSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        <nav className="topnav">
          <a href="/" className="brand">JobSeeker OS</a>
          <NavLinks />
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
