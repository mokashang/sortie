import Link from "next/link";
import { LogoMark } from "@/app/components/shell/logo";
import { getMessages } from "@/i18n/server";

// The sign-in pages: no topbar, no overview poll — one card on the paper.
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
    </div>
  );
}
