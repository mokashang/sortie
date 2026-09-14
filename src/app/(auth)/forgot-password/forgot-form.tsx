"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { AuthError, AuthHead } from "../auth-shared";

export function ForgotForm({ mailerConfigured }: { mailerConfigured: boolean }) {
  const m = useMessages();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <>
        <AuthHead title={m.auth.forgot.sentTitle} sub={m.auth.forgot.sentSubtitle(email.trim())} />
        {!mailerConfigured ? (
          <p className="auth-sub">
            {m.auth.shared.noMailerNote.before}
            <code>{m.auth.shared.noMailerNote.path}</code>
            {m.auth.shared.noMailerNote.after}
          </p>
        ) : null}
        <p className="auth-foot">
          <Link href="/login">{m.auth.shared.backToLogin}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title={m.auth.forgot.title} sub={m.auth.forgot.subtitle} />
      <form className="auth-form" onSubmit={submit}>
        <Field label={m.auth.forgot.emailLabel} htmlFor="fp-email">
          <Input id="fp-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>
          {m.auth.forgot.submit}
        </Button>
      </form>
      <p className="auth-foot">
        <Link href="/login">{m.auth.shared.backToLogin}</Link>
      </p>
    </>
  );
}
