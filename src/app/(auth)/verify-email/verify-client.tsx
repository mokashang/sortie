"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button } from "@/app/components/ui";
import { AuthError, AuthHead } from "../auth-shared";

export function VerifyClient({ email, error: linkError, mailerConfigured }: { email: string | null; error: string | null; mailerConfigured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? "验证链接已失效或用过了,重发一封再试。" : null);

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
      <AuthHead
        title="验证你的邮箱"
        sub={email ? `我们给 ${email} 发了一封邮件,点里面的链接完成验证,然后就能登录了。` : "点邮件里的链接完成验证,然后就能登录了。"}
      />
      {!mailerConfigured ? (
        <p className="auth-sub">
          这台服务器没有配置邮件发送:邮件内容写在服务器的 <code>data/outbox/</code> 目录里,打开最新的文件点里面的链接即可。
        </p>
      ) : null}
      <AuthError>{error}</AuthError>
      <div className="row mt-3">
        {email ? (
          <Button onClick={() => void resend()} loading={busy} disabled={resent}>
            {resent ? "已重发" : "重发验证邮件"}
          </Button>
        ) : null}
      </div>
      <p className="auth-foot">
        <Link href="/login">回到登录</Link>
      </p>
    </>
  );
}
