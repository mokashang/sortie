import "./globals.css";

export const metadata = { title: "JobSeeker OS" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <nav className="topnav">
          <a href="/">JobSeeker OS</a>
          <a href="/jobs">职位</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
