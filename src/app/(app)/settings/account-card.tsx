"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Laptop, LogOut, Mail, Plus, ShieldCheck, Trash, UserRound } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { deleteJson, getJson, postJson, errorMessage } from "@/app/lib/api";
import { relativeTime } from "@/app/lib/time";
import { Button, Card, Chip, ConfirmDialog, Dialog, Field, Input, useToast } from "@/app/components/ui";
import type { AuthPublicConfig } from "@/lib/auth";

// 设置 → 账号 (spec 2026-09-13 accounts §1): everything about the sign-in itself. Talks to Better
// Auth through its client (same origin, /api/auth/*) and to the App's own token routes.

export interface AccountInfo {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
}

interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}
interface AccountRow {
  id: string;
  providerId: string;
  accountId: string;
}
interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "未知设备";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /iPhone|iPad/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Linux/i.test(ua) ? "Linux" : "";
  const browser = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "";
  return [os, browser].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

function iso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString();
}

export function AccountCard({ account, auth }: { account: AccountInfo; auth: AuthPublicConfig }) {
  const router = useRouter();
  const { toast } = useToast();
  const session = authClient.useSession();
  const user = session.data?.user;
  const name = user?.name ?? account.name;
  const email = user?.email ?? account.email;
  const verified = user?.emailVerified ?? account.emailVerified;
  const currentToken = session.data?.session?.token;

  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const hasPassword = accounts?.some((a) => a.providerId === "credential") ?? false;
  const hasGoogle = accounts?.some((a) => a.providerId === "google") ?? false;

  const load = useCallback(async () => {
    const [a, s] = await Promise.all([authClient.listAccounts(), authClient.listSessions()]);
    setAccounts((a.data as AccountRow[] | null) ?? []);
    setSessions((s.data as SessionRow[] | null) ?? []);
    try {
      const t = await getJson<{ tokens: TokenRow[] }>("/api/account/tokens");
      setTokens(t.tokens);
    } catch {
      setTokens([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // ---- name / email ------------------------------------------------------------------
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveName() {
    setBusy(true);
    const { error } = await authClient.updateUser({ name: nameDraft.trim() });
    setBusy(false);
    if (error) return toast({ title: "改名失败", description: authErrorMessage(error), tone: "danger" });
    setNameOpen(false);
    toast({ title: "名字已更新", tone: "good" });
    router.refresh();
  }

  async function changeEmail() {
    setBusy(true);
    const { error } = await authClient.changeEmail({ newEmail: emailDraft.trim(), callbackURL: "/settings" });
    setBusy(false);
    if (error) return toast({ title: "修改邮箱失败", description: authErrorMessage(error), tone: "danger" });
    setEmailOpen(false);
    toast({
      title: verified ? "确认邮件已发到当前邮箱" : "邮箱已更新",
      description: verified ? "点邮件里的链接后才会生效。" : undefined,
      tone: "good",
      duration: 8000,
    });
    router.refresh();
  }

  async function resendVerification() {
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/settings" });
    if (error) return toast({ title: "发送失败", description: authErrorMessage(error), tone: "danger" });
    toast({ title: "验证邮件已发出", description: auth.mailerConfigured ? "去收件箱点链接。" : "服务器没配邮件,链接写在 data/outbox/ 里。", tone: "good", duration: 8000 });
  }

  // ---- password ------------------------------------------------------------------------
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const pwMismatch = pwConfirm.length > 0 && pwConfirm !== pwNew;

  async function savePassword() {
    if (pwMismatch || pwNew.length < 8) return;
    setBusy(true);
    try {
      if (hasPassword) {
        const { error } = await authClient.changePassword({ currentPassword: pwCurrent, newPassword: pwNew, revokeOtherSessions: true });
        if (error) throw new Error(authErrorMessage(error));
      } else {
        await postJson("/api/account/password", { newPassword: pwNew });
      }
      setPwOpen(false);
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      toast({ title: hasPassword ? "密码已修改,其他设备已退出" : "密码已设置,现在也可以用邮箱登录了", tone: "good" });
      await load();
    } catch (e) {
      toast({ title: "没成功", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  // ---- linked providers ----------------------------------------------------------------
  async function linkGoogle() {
    const { error } = await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
    if (error) toast({ title: "关联失败", description: authErrorMessage(error), tone: "danger" });
  }
  async function unlinkGoogle() {
    const google = accounts?.find((a) => a.providerId === "google");
    if (!google) return;
    const { error } = await authClient.unlinkAccount({ accountId: google.accountId });
    if (error) return toast({ title: "解除失败", description: authErrorMessage(error), tone: "danger" });
    toast({ title: "已解除 Google 关联", tone: "neutral" });
    await load();
  }

  // ---- sessions ------------------------------------------------------------------------
  async function revoke(token: string) {
    const { error } = await authClient.revokeSession({ token });
    if (error) return toast({ title: "退出失败", description: authErrorMessage(error), tone: "danger" });
    await load();
  }
  async function revokeOthers() {
    const { error } = await authClient.revokeOtherSessions();
    if (error) return toast({ title: "退出失败", description: authErrorMessage(error), tone: "danger" });
    toast({ title: "其他设备已全部退出", tone: "good" });
    await load();
  }

  // ---- tokens --------------------------------------------------------------------------
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [revokeTokenId, setRevokeTokenId] = useState<number | null>(null);

  async function createToken() {
    setBusy(true);
    try {
      const j = await postJson<{ token: string }>("/api/account/tokens", { name: tokenName.trim() || "我的电脑" });
      setFreshToken(j.token);
      setTokenName("");
      await load();
    } catch (e) {
      toast({ title: "创建失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  async function revokeTokenNow() {
    if (revokeTokenId == null) return;
    setBusy(true);
    try {
      await deleteJson(`/api/account/tokens?id=${revokeTokenId}`);
      setRevokeTokenId(null);
      toast({ title: "令牌已撤销", tone: "neutral" });
      await load();
    } catch (e) {
      toast({ title: "撤销失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "已复制", tone: "good" });
    } catch {
      toast({ title: "复制失败,手动选中复制吧", tone: "warn" });
    }
  }

  // ---- delete --------------------------------------------------------------------------
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  async function deleteAccount() {
    setBusy(true);
    const { data, error } = await authClient.deleteUser({ password: hasPassword ? deletePw : undefined, callbackURL: "/login" });
    setBusy(false);
    if (error) return toast({ title: "删除失败", description: authErrorMessage(error), tone: "danger" });
    if ((data as { message?: string } | null)?.message === "Verification email sent") {
      setDeleteOpen(false);
      toast({ title: "确认邮件已发出", description: "点邮件里的链接后账号才会被删除。", tone: "warn", duration: 10000 });
      return;
    }
    router.push("/login");
    router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="account-grid">
      <Card>
        <div className="row between mb-2">
          <div className="row gap-1">
            <UserRound size={15} aria-hidden className="muted" />
            <span className="strong">{name}</span>
            {account.role === "owner" ? (
              <Chip tone="accent" title="这台机器的主账号:认领了迁移前的数据,后台助手以它的身份运行">
                主账号
              </Chip>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setNameDraft(name); setNameOpen(true); }}>
            改名
          </Button>
        </div>
        <div className="row between">
          <div className="row gap-1">
            <Mail size={15} aria-hidden className="muted" />
            <span>{email}</span>
            {verified ? (
              <Chip tone="good" icon={<ShieldCheck size={11} />}>
                已验证
              </Chip>
            ) : (
              <Chip tone="warn">未验证</Chip>
            )}
          </div>
          <div className="row">
            {!verified ? (
              <Button size="sm" variant="ghost" onClick={() => void resendVerification()}>
                重发验证邮件
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => { setEmailDraft(""); setEmailOpen(true); }}>
              改邮箱
            </Button>
          </div>
        </div>
        <div className="row mt-4">
          <Button size="sm" icon={<KeyRound size={13} />} onClick={() => setPwOpen(true)} disabled={accounts === null}>
            {hasPassword ? "修改密码" : "设置密码"}
          </Button>
          {auth.googleEnabled ? (
            hasGoogle ? (
              <Button size="sm" variant="ghost" onClick={() => void unlinkGoogle()} disabled={!hasPassword} title={!hasPassword ? "先设置密码,否则解除后就没法登录了" : undefined}>
                解除 Google 关联
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void linkGoogle()}>
                关联 Google 账号
              </Button>
            )
          ) : null}
          <Button size="sm" variant="ghost" icon={<LogOut size={13} />} onClick={() => void signOut()}>
            退出登录
          </Button>
        </div>
      </Card>

      <Card>
        <div className="row between mb-2">
          <span className="strong row gap-1">
            <Laptop size={15} aria-hidden className="muted" /> 已登录的设备
          </span>
          {sessions && sessions.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => void revokeOthers()}>
              退出其他设备
            </Button>
          ) : null}
        </div>
        {sessions === null ? (
          <p className="muted small">加载中…</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="session-row">
              <div className="grow">
                <div className="small">
                  {describeAgent(s.userAgent)}
                  {s.token === currentToken ? <Chip tone="good" className="ml-2">当前</Chip> : null}
                </div>
                <div className="muted xs">
                  {s.ipAddress || "本机"} · 最近活动 {relativeTime(iso(s.updatedAt))}
                </div>
              </div>
              {s.token !== currentToken ? (
                <Button size="sm" variant="ghost" onClick={() => void revoke(s.token)}>
                  退出
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Card>

      <Card>
        <div className="row between mb-2">
          <span className="strong row gap-1">
            <KeyRound size={15} aria-hidden className="muted" /> 助手令牌
          </span>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => { setFreshToken(null); setTokenOpen(true); }}>
            新建令牌
          </Button>
        </div>
        <p className="muted small mb-2">
          在你自己电脑上跑值守会话或脚本时用的访问凭证:请求头 <code>authorization: Bearer &lt;令牌&gt;</code>。这台服务器上的桌面会话不需要,它用机器自己的内部令牌。
        </p>
        {tokens === null ? (
          <p className="muted small">加载中…</p>
        ) : tokens.length === 0 ? (
          <p className="muted small">还没有令牌。</p>
        ) : (
          tokens.map((t) => (
            <div key={t.id} className="token-row">
              <div className="grow">
                <div className="small">
                  {t.name} <span className="mono muted xs">{t.prefix}…</span>
                </div>
                <div className="muted xs">
                  创建于 {relativeTime(t.createdAt)}
                  {t.lastUsedAt ? ` · 最近使用 ${relativeTime(t.lastUsedAt)}` : " · 还没用过"}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => setRevokeTokenId(t.id)}>
                撤销
              </Button>
            </div>
          ))
        )}
      </Card>

      <Card className="danger-zone">
        <div className="strong mb-2">删除账号</div>
        <p className="muted small mb-2">删掉你的档案、经历、简历、投递记录和人脉。公共的职位库不受影响。这一步无法撤销。</p>
        <Button size="sm" variant="danger" icon={<Trash size={13} />} onClick={() => setDeleteOpen(true)}>
          删除我的账号…
        </Button>
      </Card>

      <Dialog open={nameOpen} onClose={() => setNameOpen(false)} title="改名" size="sm" actions={<><Button variant="ghost" onClick={() => setNameOpen(false)}>取消</Button><Button variant="primary" onClick={() => void saveName()} loading={busy} disabled={!nameDraft.trim()}>保存</Button></>}>
        <Field label="名字" htmlFor="acc-name">
          <Input id="acc-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="修改登录邮箱"
        description={verified ? "会先给当前邮箱发一封确认邮件,点链接后才生效。" : "当前邮箱还没验证,可以直接改。"}
        size="sm"
        actions={<><Button variant="ghost" onClick={() => setEmailOpen(false)}>取消</Button><Button variant="primary" onClick={() => void changeEmail()} loading={busy} disabled={!emailDraft.includes("@")}>确定</Button></>}
      >
        <Field label="新邮箱" htmlFor="acc-email">
          <Input id="acc-email" type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={hasPassword ? "修改密码" : "设置密码"}
        description={hasPassword ? "改完后其他设备会被退出。" : "这个账号是用 Google 登录的;设个密码就也能用邮箱登录。"}
        size="sm"
        actions={<><Button variant="ghost" onClick={() => setPwOpen(false)}>取消</Button><Button variant="primary" onClick={() => void savePassword()} loading={busy} disabled={pwMismatch || pwNew.length < 8 || (hasPassword && !pwCurrent)}>保存</Button></>}
      >
        <div className="col gap-3">
          {hasPassword ? (
            <Field label="当前密码" htmlFor="acc-pw-current">
              <Input id="acc-pw-current" type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoFocus />
            </Field>
          ) : null}
          <Field label="新密码" htmlFor="acc-pw-new" hint="至少 8 位。">
            <Input id="acc-pw-new" type="password" autoComplete="new-password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
          </Field>
          <Field label="再输一遍" htmlFor="acc-pw-confirm" error={pwMismatch ? "两次输入的密码不一样。" : undefined}>
            <Input id="acc-pw-confirm" type="password" autoComplete="new-password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={tokenOpen}
        onClose={() => { setTokenOpen(false); setFreshToken(null); }}
        title="新建助手令牌"
        description={freshToken ? "令牌只显示这一次,复制后保存好。" : "给它起个名字,方便以后知道是哪台电脑在用。"}
        size="sm"
        actions={
          freshToken ? (
            <Button variant="primary" onClick={() => { setTokenOpen(false); setFreshToken(null); }}>完成</Button>
          ) : (
            <><Button variant="ghost" onClick={() => setTokenOpen(false)}>取消</Button><Button variant="primary" onClick={() => void createToken()} loading={busy}>创建</Button></>
          )
        }
      >
        {freshToken ? (
          <div className="col gap-3">
            <div className="token-plain">{freshToken}</div>
            <div className="row">
              <Button size="sm" icon={<Copy size={13} />} onClick={() => void copy(freshToken)}>
                复制
              </Button>
              <span className="muted xs">用法:每条 curl 加 <code>-H &quot;authorization: Bearer {"<令牌>"}&quot;</code></span>
            </div>
          </div>
        ) : (
          <Field label="名字" htmlFor="acc-token-name">
            <Input id="acc-token-name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="如 我的 MacBook" autoFocus />
          </Field>
        )}
      </Dialog>

      <ConfirmDialog open={revokeTokenId != null} onClose={() => setRevokeTokenId(null)} onConfirm={revokeTokenNow} title="撤销这个令牌?" description="用它的会话会立刻收到 401,需要换新令牌。" confirmLabel="撤销" danger busy={busy} />

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="删除账号"
        description="档案、经历、简历、投递记录和人脉都会被删掉,无法恢复。"
        size="sm"
        actions={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" onClick={() => void deleteAccount()} loading={busy} disabled={hasPassword && !deletePw}>确认删除</Button></>}
      >
        {hasPassword ? (
          <Field label="输入密码确认" htmlFor="acc-del-pw">
            <Input id="acc-del-pw" type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} autoFocus />
          </Field>
        ) : (
          <p className="small">{auth.mailerConfigured ? "会先发一封确认邮件到你的邮箱。" : "点确认后立刻删除(刚登录不久才允许;否则请重新登录后再试)。"}</p>
        )}
      </Dialog>
    </div>
  );
}
