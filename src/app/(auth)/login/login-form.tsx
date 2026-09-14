"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { AuthDivider, AuthError, AuthHead, GoogleButton, safeNext } from "../auth-shared";

export function LoginForm({ next, oauthError, googleEnabled, signupOpen }: { next: string | null; oauthError: string | null; googleEnabled: boolean; signupOpen: boolean }) {
  const router = useRouter();
  const dest = safeNext(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? "Google 登录没有完成,请再试一次或改用邮箱。" : null);
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
      <AuthHead title="登录" sub="回到你的求职作战室。" />
      {googleEnabled ? (
        <>
          <GoogleButton onClick={() => void google()} loading={googleBusy} />
          <AuthDivider>或用邮箱</AuthDivider>
        </>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <Field label="邮箱" htmlFor="login-email">
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field
          label={
            <span className="row between grow">
              <span>密码</span>
              <Link href="/forgot-password" className="xs">
                忘记密码?
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
              {resent ? "已重发,去收件箱看看" : "重发验证邮件"}
            </Button>
          </div>
        ) : null}
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>
          登录
        </Button>
      </form>
      <p className="auth-foot">
        {signupOpen ? (
          <>
            还没有账号? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>创建一个</Link>
          </>
        ) : (
          "这个 Sortie 实例已关闭注册。"
        )}
      </p>
    </>
  );
}
