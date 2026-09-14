import Link from "next/link";

// The sign-in pages: no sidebar, no overview poll — one card on the paper.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand">
          Sortie <span className="brand-tag">求职助手</span>
        </Link>
        {children}
      </div>
    </div>
  );
}
