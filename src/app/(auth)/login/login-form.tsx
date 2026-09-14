"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { AuthDivider, AuthError, AuthHead, GoogleButton, safeNext } from "../auth-shared";

export function LoginForm({ next, oauthError, googleEnabled, signupOpen }: { next: string | null; oauthError: string | null; googleEnabled: boolean; signupOpen: boolean }) {
  const router = useRouter();
  const m = useMessages();
  const dest = safeNext(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? m.auth.login.googleFailed : null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      if (err.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      return;
    }
    router.push(dest);
    router.refresh();
  }

  async function resend() {
    const { error: err } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: dest });
    if (err) setError(authErrorMessage(err));
    else setResent(true);
  }

  async function google() {
    setGoogleBusy(true);
    const { error: err } = await authClient.signIn.social({
      provider: "google",
      callbackURL: dest,
      errorCallbackURL: "/login?error=google",
      newUserCallbackURL: "/profile?tab=basics&welcome=1",
    });
    if (err) {
      setError(authErrorMessage(err));
      setGoogleBusy(false);
    }
  }

  return (
    <>
      <AuthHead title={m.auth.login.title} sub={m.auth.login.subtitle} />
      {googleEnabled ? (
        <>
          <GoogleButton onClick={() => void google()} loading={googleBusy} />
          <AuthDivider>{m.auth.shared.orEmail}</AuthDivider>
        </>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <Field label={m.auth.login.emailLabel} htmlFor="login-email">
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field
          label={
            <span className="row between grow">
              <span>{m.auth.login.passwordLabel}</span>
              <Link href="/forgot-password" className="xs">
                {m.auth.login.forgotPassword}
              </Link>
            </span>
          }
          htmlFor="login-password"
        >
          <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <AuthError>{error}</AuthError>
        {unverified ? (
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => void resend()} disabled={resent}>
              {resent ? m.auth.login.resent : m.auth.login.resend}
            </Button>
          </div>
        ) : null}
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>
          {m.auth.login.submit}
        </Button>
      </form>
      <p className="auth-foot">
        {signupOpen ? (
          <>
            {m.auth.login.noAccountYet}
            <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>{m.auth.login.createOne}</Link>
          </>
        ) : (
          m.auth.login.signupClosed
        )}
      </p>
    </>
  );
}
