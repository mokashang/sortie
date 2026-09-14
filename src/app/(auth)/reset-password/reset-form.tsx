"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { AuthError, AuthHead } from "../auth-shared";

const MIN_PASSWORD = 8;

export function ResetForm({ token, error: linkError }: { token: string | null; error: string | null }) {
  const router = useRouter();
  const m = useMessages();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  if (!token || linkError) {
    return (
      <>
        <AuthHead title={m.auth.reset.expiredTitle} sub={m.auth.reset.expiredSubtitle} />
        <p className="auth-foot">
          <Link href="/forgot-password">{m.auth.reset.requestNew}</Link> · <Link href="/login">{m.auth.shared.backToLogin}</Link>
        </p>
      </>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || password.length < MIN_PASSWORD) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token: token as string });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1200);
  }

  if (done) {
    return (
      <>
        <AuthHead title={m.auth.reset.doneTitle} sub={m.auth.reset.doneSubtitle} />
        <p className="auth-foot">
          <Link href="/login">{m.auth.shared.goToLogin}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title={m.auth.reset.title} />
      <form className="auth-form" onSubmit={submit}>
        <Field label={m.auth.reset.newPasswordLabel} htmlFor="rp-password" hint={m.auth.shared.minPasswordHint(MIN_PASSWORD)}>
          <Input id="rp-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label={m.auth.reset.confirmLabel} htmlFor="rp-confirm" error={mismatch ? m.auth.shared.passwordMismatch : undefined}>
          <Input id="rp-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy} disabled={mismatch || password.length < MIN_PASSWORD}>
          {m.auth.reset.submit}
        </Button>
      </form>
    </>
  );
}
