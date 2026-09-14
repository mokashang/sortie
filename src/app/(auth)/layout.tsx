import Link from "next/link";
import { LogoMark } from "@/app/components/shell/logo";
import { getMessages } from "@/i18n/server";
import { AuthLangToggle } from "./lang-toggle";

// The sign-in pages: no topbar, no overview poll — one card on the paper, the language switch
// underneath it (the top bar that normally carries it is not shown here), and the two public
// documents a stranger may want to read before creating an account.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const m = await getMessages();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand" aria-label={m.shell.home}>
          <LogoMark className="brand-mark" />
          <span className="brand-word">Sortie</span>
        </Link>
        {children}
      </div>
      <AuthLangToggle />
      <nav className="auth-legal">
        <Link href="/privacy">{m.legal.privacy.title}</Link>
        <Link href="/terms">{m.legal.terms.title}</Link>
      </nav>
    </div>
  );
}
