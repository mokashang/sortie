"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { AuthDivider, AuthError, AuthHead, GoogleButton, safeNext } from "../auth-shared";

const MIN_PASSWORD = 8;

export function SignupForm({ next, googleEnabled, signupOpen, verificationRequired }: { next: string | null; googleEnabled: boolean; signupOpen: boolean; verificationRequired: boolean }) {
  const router = useRouter();
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
        <AuthHead title="注册已关闭" sub="这个 Sortie 实例不接受新账号。" />
        <p className="auth-foot">
          已有账号? <Link href="/login">去登录</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title="创建账号" sub="你的职位、投递、人脉和档案只有你自己能看到。" />
      {googleEnabled ? (
        <>
          <GoogleButton onClick={() => void google()} loading={googleBusy} />
          <AuthDivider>或用邮箱</AuthDivider>
        </>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <Field label="姓名" htmlFor="su-name" hint="投递表单里也用这个名字,写真实姓名。">
          <Input id="su-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="邮箱" htmlFor="su-email">
          <Input id="su-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码" htmlFor="su-password" hint={`至少 ${MIN_PASSWORD} 位。`} error={tooShort ? `密码至少 ${MIN_PASSWORD} 位。` : undefined}>
          <Input id="su-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="再输一遍密码" htmlFor="su-confirm" error={mismatch ? "两次输入的密码不一样。" : undefined}>
          <Input id="su-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy} disabled={mismatch || tooShort}>
          创建账号
        </Button>
      </form>
      <p className="auth-foot">
        已有账号? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>去登录</Link>
      </p>
    </>
  );
}
