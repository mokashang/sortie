"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { AuthError, AuthHead } from "../auth-shared";

export function ForgotForm({ mailerConfigured }: { mailerConfigured: boolean }) {
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
        <AuthHead title="邮件已发出" sub={`如果 ${email.trim()} 是一个 Sortie 账号,一封重置密码的邮件已经在路上,链接 1 小时内有效。`} />
        {!mailerConfigured ? (
          <p className="auth-sub">
            这台服务器没有配置邮件发送:邮件内容写在服务器的 <code>data/outbox/</code> 目录里,打开最新的文件点里面的链接即可。
          </p>
        ) : null}
        <p className="auth-foot">
          <Link href="/login">回到登录</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title="找回密码" sub="输入注册邮箱,我们发一封带重置链接的邮件给你。" />
      <form className="auth-form" onSubmit={submit}>
        <Field label="邮箱" htmlFor="fp-email">
          <Input id="fp-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>
          发送重置邮件
        </Button>
      </form>
      <p className="auth-foot">
        <Link href="/login">回到登录</Link>
      </p>
    </>
  );
}
