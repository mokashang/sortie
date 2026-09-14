"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button, Field, Input } from "@/app/components/ui";
import { AuthError, AuthHead } from "../auth-shared";

const MIN_PASSWORD = 8;

export function ResetForm({ token, error: linkError }: { token: string | null; error: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  if (!token || linkError) {
    return (
      <>
        <AuthHead title="链接已失效" sub="这个重置链接已经过期或用过了。重新申请一封即可。" />
        <p className="auth-foot">
          <Link href="/forgot-password">重新申请</Link> · <Link href="/login">回到登录</Link>
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
        <AuthHead title="密码已更新" sub="用新密码登录吧。其他设备上的登录已全部退出。" />
        <p className="auth-foot">
          <Link href="/login">去登录</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHead title="设置新密码" />
      <form className="auth-form" onSubmit={submit}>
        <Field label="新密码" htmlFor="rp-password" hint={`至少 ${MIN_PASSWORD} 位。`}>
          <Input id="rp-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="再输一遍" htmlFor="rp-confirm" error={mismatch ? "两次输入的密码不一样。" : undefined}>
          <Input id="rp-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="btn-block" loading={busy} disabled={mismatch || password.length < MIN_PASSWORD}>
          保存新密码
        </Button>
      </form>
    </>
  );
}
