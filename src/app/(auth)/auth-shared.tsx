"use client";
import { Button } from "@/app/components/ui";

// Bits every sign-in page shares: the heading, the inline error note and the Google button.

export function AuthHead({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <>
      <h1 className="auth-title">{title}</h1>
      {sub ? <p className="auth-sub">{sub}</p> : null}
    </>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="auth-error" role="alert">
      {children}
    </div>
  );
}

export function AuthDivider({ children = "或" }: { children?: React.ReactNode }) {
  return <div className="auth-divider">{children}</div>;
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.5 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ onClick, loading, children = "使用 Google 继续" }: { onClick: () => void; loading?: boolean; children?: React.ReactNode }) {
  return (
    <Button className="btn-block" icon={<GoogleMark />} onClick={onClick} loading={loading}>
      {children}
    </Button>
  );
}

// Only same-site paths are honoured as a post-login destination.
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
