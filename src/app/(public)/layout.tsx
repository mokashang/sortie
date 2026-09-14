import Link from "next/link";
import { LogoMark } from "@/app/components/shell/logo";
import { AuthLangToggle } from "@/app/(auth)/lang-toggle";
import { getMessages } from "@/i18n/server";

// The public documents (/privacy, /terms — the pages Google's sign-in branding links to): no
// session, no top bar, no overview poll. One readable column on the paper, the brand above it,
// the other document / a way back / the language switch below it.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const m = await getMessages();
  return (
    <div className="legal-wrap">
      <header className="legal-head">
        <Link href="/" className="brand" aria-label={m.shell.home}>
          <LogoMark className="brand-mark" />
          <span className="brand-word">Sortie</span>
        </Link>
      </header>
      <main className="legal-main">{children}</main>
      <footer className="legal-foot">
        <nav className="legal-nav">
          <Link href="/privacy">{m.legal.privacy.title}</Link>
          <Link href="/terms">{m.legal.terms.title}</Link>
          <Link href="/">{m.legal.backToApp}</Link>
        </nav>
        <AuthLangToggle />
      </footer>
    </div>
  );
}
