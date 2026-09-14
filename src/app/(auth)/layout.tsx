import Link from "next/link";
import { LogoMark } from "@/app/components/shell/logo";

// The sign-in pages: no topbar, no overview poll — one card on the paper.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand" aria-label="Sortie 首页">
          <LogoMark className="brand-mark" />
          <span className="brand-word">Sortie</span>
        </Link>
        {children}
      </div>
    </div>
  );
}
