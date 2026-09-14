"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { AuthError, AuthHead } from "../auth-shared";

export function VerifyClient({ email, error: linkError, mailerConfigured }: { email: string | null; error: string | null; mailerConfigured: boolean }) {
  const m = useMessages();
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? m.auth.verify.linkInvalid : null);

  async function resend() {
    if (!email) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({ email, callbackURL: "/profile?tab=basics&welcome=1" });
    setBusy(false);
    if (err) setError(authErrorMessage(err));
    else setResent(true);
  }

  return (
    <>
      <AuthHead title={m.auth.verify.title} sub={email ? m.auth.verify.subtitleWithEmail(email) : m.auth.verify.subtitleNoEmail} />
      {!mailerConfigured ? (
        <p className="auth-sub">
          {m.auth.shared.noMailerNote.before}
          <code>{m.auth.shared.noMailerNote.path}</code>
          {m.auth.shared.noMailerNote.after}
        </p>
      ) : null}
      <AuthError>{error}</AuthError>
      <div className="row mt-3">
        {email ? (
          <Button onClick={() => void resend()} loading={busy} disabled={resent}>
            {resent ? m.auth.verify.resent : m.auth.verify.resend}
          </Button>
        ) : null}
      </div>
      <p className="auth-foot">
        <Link href="/login">{m.auth.shared.backToLogin}</Link>
      </p>
    </>
  );
}
