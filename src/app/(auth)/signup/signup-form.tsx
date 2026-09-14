"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { AuthDivider, AuthError, AuthHead, GoogleButton, safeNext } from "../auth-shared";

const MIN_PASSWORD = 8;

export function SignupForm({ next, googleEnabled, signupOpen, verificationRequired }: { next: string | null; googleEnabled: boolean; signupOpen: boolean; verificationRequired: boolean }) {
  const router = useRouter();
  const m = useMessages();
  const dest = safeNext(next, "/profile?tab=basics&welcome=1");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: dest });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    if (verificationRequired) {
      router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
      return;
    }
    router.push(dest);
    router.refresh();
  }

  async function google() {
    setGoogleBusy(true);
    const { error: err } = await authClient.signIn.social({
      provider: "google",
      callbackURL: safeNext(next),
      errorCallbackURL: "/login?error=google",
      newUserCallbackURL: "/profile?tab=basics&welcome=1",
    });
    if (err) {
      setError(authErrorMessage(err));
      setGoogleBusy(false);
    }
  }

  if (!signupOpen) {
    return (
      <>
        <AuthHead title={m.auth.signup.closedTitle} sub={m.auth.signup.closedSubtitle} />
        <p className="auth-foot">
          {m.auth.signup.alreadyHaveAccount}
          <Link href="/login">{m.auth.shared.goToLogin}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title={m.auth.signup.title} sub={m.auth.signup.subtitle} />
      {googleEnabled ? (
        <>
          <GoogleButton onClick={() => void google()} loading={googleBusy} />
          <AuthDivider>{m.auth.shared.orEmail}</AuthDivider>
        </>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <Field label={m.auth.signup.nameLabel} htmlFor="su-name" hint={m.auth.signup.nameHint}>
          <Input id="su-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={m.auth.signup.emailLabel} htmlFor="su-email">
          <Input id="su-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label={m.auth.signup.passwordLabel}
          htmlFor="su-password"
          hint={m.auth.shared.minPasswordHint(MIN_PASSWORD)}
          error={tooShort ? m.auth.signup.passwordTooShort(MIN_PASSWORD) : undefined}
        >
          <Input id="su-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={m.auth.signup.confirmLabel} htmlFor="su-confirm" error={mismatch ? m.auth.shared.passwordMismatch : undefined}>
          <Input id="su-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy} disabled={mismatch || tooShort}>
          {m.auth.signup.submit}
        </Button>
      </form>
      <p className="auth-foot">
        {m.auth.signup.alreadyHaveAccount}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>{m.auth.shared.goToLogin}</Link>
      </p>
    </>
  );
}
