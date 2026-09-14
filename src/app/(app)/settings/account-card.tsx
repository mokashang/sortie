"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Laptop, LogOut, Mail, Plus, ShieldCheck, Trash, UserRound } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { deleteJson, getJson, postJson, errorMessage } from "@/app/lib/api";
import { relativeTime } from "@/app/lib/time";
import { Button, Card, Chip, ConfirmDialog, Dialog, Field, Input, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";
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

function describeAgent(ua: string | null | undefined, unknownDevice: string): string {
  if (!ua) return unknownDevice;
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
  const m = useMessages();
  const lang = useLang();
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
    if (error) return toast({ title: m.settings.accountCard.toast.renameFailed, description: authErrorMessage(error), tone: "danger" });
    setNameOpen(false);
    toast({ title: m.settings.accountCard.toast.renamed, tone: "good" });
    router.refresh();
  }

  async function changeEmail() {
    setBusy(true);
    const { error } = await authClient.changeEmail({ newEmail: emailDraft.trim(), callbackURL: "/settings" });
    setBusy(false);
    if (error) return toast({ title: m.settings.accountCard.toast.emailChangeFailed, description: authErrorMessage(error), tone: "danger" });
    setEmailOpen(false);
    toast({
      title: verified ? m.settings.accountCard.toast.emailConfirmSent : m.settings.accountCard.toast.emailUpdated,
      description: verified ? m.settings.accountCard.toast.emailConfirmHint : undefined,
      tone: "good",
      duration: 8000,
    });
    router.refresh();
  }

  async function resendVerification() {
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/settings" });
    if (error) return toast({ title: m.settings.accountCard.toast.resendFailed, description: authErrorMessage(error), tone: "danger" });
    toast({
      title: m.settings.accountCard.toast.verificationSent,
      description: auth.mailerConfigured ? m.settings.accountCard.toast.checkInbox : m.settings.accountCard.toast.noMailerOutbox,
      tone: "good",
      duration: 8000,
    });
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
      toast({ title: hasPassword ? m.settings.accountCard.toast.passwordChanged : m.settings.accountCard.toast.passwordSet, tone: "good" });
      await load();
    } catch (e) {
      toast({ title: m.settings.accountCard.toast.notSuccessful, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  // ---- linked providers ----------------------------------------------------------------
  async function linkGoogle() {
    const { error } = await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
    if (error) toast({ title: m.settings.accountCard.toast.linkFailed, description: authErrorMessage(error), tone: "danger" });
  }
  async function unlinkGoogle() {
    const google = accounts?.find((a) => a.providerId === "google");
    if (!google) return;
    const { error } = await authClient.unlinkAccount({ accountId: google.accountId });
    if (error) return toast({ title: m.settings.accountCard.toast.unlinkFailed, description: authErrorMessage(error), tone: "danger" });
    toast({ title: m.settings.accountCard.toast.googleUnlinked, tone: "neutral" });
    await load();
  }

  // ---- sessions ------------------------------------------------------------------------
  async function revoke(token: string) {
    const { error } = await authClient.revokeSession({ token });
    if (error) return toast({ title: m.settings.accountCard.toast.signOutFailed, description: authErrorMessage(error), tone: "danger" });
    await load();
  }
  async function revokeOthers() {
    const { error } = await authClient.revokeOtherSessions();
    if (error) return toast({ title: m.settings.accountCard.toast.signOutFailed, description: authErrorMessage(error), tone: "danger" });
    toast({ title: m.settings.accountCard.toast.othersSignedOut, tone: "good" });
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
      const j = await postJson<{ token: string }>("/api/account/tokens", { name: tokenName.trim() || m.settings.accountCard.tokenDialog.defaultName });
      setFreshToken(j.token);
      setTokenName("");
      await load();
    } catch (e) {
      toast({ title: m.settings.accountCard.toast.createTokenFailed, description: errorMessage(e), tone: "danger" });
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
      toast({ title: m.settings.accountCard.toast.tokenRevoked, tone: "neutral" });
      await load();
    } catch (e) {
      toast({ title: m.settings.accountCard.toast.revokeTokenFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: m.common.copied, tone: "good" });
    } catch {
      toast({ title: m.settings.accountCard.toast.copyFailed, tone: "warn" });
    }
  }

  // ---- delete --------------------------------------------------------------------------
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  async function deleteAccount() {
    setBusy(true);
    const { data, error } = await authClient.deleteUser({ password: hasPassword ? deletePw : undefined, callbackURL: "/login" });
    setBusy(false);
    if (error) return toast({ title: m.settings.accountCard.toast.deleteFailed, description: authErrorMessage(error), tone: "danger" });
    if ((data as { message?: string } | null)?.message === "Verification email sent") {
      setDeleteOpen(false);
      toast({ title: m.settings.accountCard.toast.deleteConfirmSent, description: m.settings.accountCard.toast.deleteConfirmHint, tone: "warn", duration: 10000 });
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
              <Chip tone="accent" title={m.settings.accountCard.owner.tooltip}>
                {m.settings.accountCard.owner.chip}
              </Chip>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setNameDraft(name); setNameOpen(true); }}>
            {m.settings.accountCard.rename}
          </Button>
        </div>
        <div className="row between">
          <div className="row gap-1">
            <Mail size={15} aria-hidden className="muted" />
            <span>{email}</span>
            {verified ? (
              <Chip tone="good" icon={<ShieldCheck size={11} />}>
                {m.settings.accountCard.verified}
              </Chip>
            ) : (
              <Chip tone="warn">{m.settings.accountCard.notVerified}</Chip>
            )}
          </div>
          <div className="row">
            {!verified ? (
              <Button size="sm" variant="ghost" onClick={() => void resendVerification()}>
                {m.settings.accountCard.resendVerification}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => { setEmailDraft(""); setEmailOpen(true); }}>
              {m.settings.accountCard.changeEmail}
            </Button>
          </div>
        </div>
        <div className="row mt-4">
          <Button size="sm" icon={<KeyRound size={13} />} onClick={() => setPwOpen(true)} disabled={accounts === null}>
            {hasPassword ? m.settings.accountCard.changePassword : m.settings.accountCard.setPassword}
          </Button>
          {auth.googleEnabled ? (
            hasGoogle ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void unlinkGoogle()}
                disabled={!hasPassword}
                title={!hasPassword ? m.settings.accountCard.unlinkGoogleDisabledTitle : undefined}
              >
                {m.settings.accountCard.unlinkGoogle}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void linkGoogle()}>
                {m.settings.accountCard.linkGoogle}
              </Button>
            )
          ) : null}
          <Button size="sm" variant="ghost" icon={<LogOut size={13} />} onClick={() => void signOut()}>
            {m.settings.accountCard.signOut}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="row between mb-2">
          <span className="strong row gap-1">
            <Laptop size={15} aria-hidden className="muted" /> {m.settings.accountCard.sessions.title}
          </span>
          {sessions && sessions.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => void revokeOthers()}>
              {m.settings.accountCard.sessions.signOutOthers}
            </Button>
          ) : null}
        </div>
        {sessions === null ? (
          <p className="muted small">{m.settings.accountCard.sessions.loading}</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="session-row">
              <div className="grow">
                <div className="small">
                  {describeAgent(s.userAgent, m.settings.accountCard.unknownDevice)}
                  {s.token === currentToken ? (
                    <Chip tone="good" className="ml-2">
                      {m.settings.accountCard.sessions.current}
                    </Chip>
                  ) : null}
                </div>
                <div className="muted xs">
                  {s.ipAddress || m.settings.accountCard.sessions.thisMachine} · {m.settings.accountCard.sessions.lastActive(relativeTime(iso(s.updatedAt), lang))}
                </div>
              </div>
              {s.token !== currentToken ? (
                <Button size="sm" variant="ghost" onClick={() => void revoke(s.token)}>
                  {m.settings.accountCard.sessions.signOutThis}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Card>

      <Card>
        <div className="row between mb-2">
          <span className="strong row gap-1">
            <KeyRound size={15} aria-hidden className="muted" /> {m.settings.accountCard.tokens.title}
          </span>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => { setFreshToken(null); setTokenOpen(true); }}>
            {m.settings.accountCard.tokens.create}
          </Button>
        </div>
        <p className="muted small mb-2">
          {m.settings.accountCard.tokens.introBefore}
          <code>{m.settings.accountCard.tokens.introCode}</code>
          {m.settings.accountCard.tokens.introAfter}
        </p>
        {tokens === null ? (
          <p className="muted small">{m.settings.accountCard.tokens.loading}</p>
        ) : tokens.length === 0 ? (
          <p className="muted small">{m.settings.accountCard.tokens.empty}</p>
        ) : (
          tokens.map((t) => (
            <div key={t.id} className="token-row">
              <div className="grow">
                <div className="small">
                  {t.name} <span className="mono muted xs">{t.prefix}…</span>
                </div>
                <div className="muted xs">
                  {m.settings.accountCard.tokens.createdAt(relativeTime(t.createdAt, lang))}
                  {t.lastUsedAt ? m.settings.accountCard.tokens.lastUsed(relativeTime(t.lastUsedAt, lang)) : m.settings.accountCard.tokens.neverUsed}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => setRevokeTokenId(t.id)}>
                {m.settings.accountCard.tokens.revoke}
              </Button>
            </div>
          ))
        )}
      </Card>

      <Card className="danger-zone">
        <div className="strong mb-2">{m.settings.accountCard.danger.title}</div>
        <p className="muted small mb-2">{m.settings.accountCard.danger.description}</p>
        <Button size="sm" variant="danger" icon={<Trash size={13} />} onClick={() => setDeleteOpen(true)}>
          {m.settings.accountCard.danger.button}
        </Button>
      </Card>

      <Dialog
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title={m.settings.accountCard.nameDialog.title}
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setNameOpen(false)}>
              {m.common.cancel}
            </Button>
            <Button variant="primary" onClick={() => void saveName()} loading={busy} disabled={!nameDraft.trim()}>
              {m.common.save}
            </Button>
          </>
        }
      >
        <Field label={m.settings.accountCard.nameDialog.label} htmlFor="acc-name">
          <Input id="acc-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title={m.settings.accountCard.emailDialog.title}
        description={verified ? m.settings.accountCard.emailDialog.descriptionVerified : m.settings.accountCard.emailDialog.descriptionUnverified}
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setEmailOpen(false)}>
              {m.common.cancel}
            </Button>
            <Button variant="primary" onClick={() => void changeEmail()} loading={busy} disabled={!emailDraft.includes("@")}>
              {m.settings.accountCard.emailDialog.confirm}
            </Button>
          </>
        }
      >
        <Field label={m.settings.accountCard.emailDialog.label} htmlFor="acc-email">
          <Input id="acc-email" type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={hasPassword ? m.settings.accountCard.passwordDialog.changeTitle : m.settings.accountCard.passwordDialog.setTitle}
        description={hasPassword ? m.settings.accountCard.passwordDialog.changeDescription : m.settings.accountCard.passwordDialog.setDescription}
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setPwOpen(false)}>
              {m.common.cancel}
            </Button>
            <Button variant="primary" onClick={() => void savePassword()} loading={busy} disabled={pwMismatch || pwNew.length < 8 || (hasPassword && !pwCurrent)}>
              {m.common.save}
            </Button>
          </>
        }
      >
        <div className="col gap-3">
          {hasPassword ? (
            <Field label={m.settings.accountCard.passwordDialog.current} htmlFor="acc-pw-current">
              <Input id="acc-pw-current" type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoFocus />
            </Field>
          ) : null}
          <Field label={m.settings.accountCard.passwordDialog.new} htmlFor="acc-pw-new" hint={m.settings.accountCard.passwordDialog.hint}>
            <Input id="acc-pw-new" type="password" autoComplete="new-password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
          </Field>
          <Field label={m.settings.accountCard.passwordDialog.confirm} htmlFor="acc-pw-confirm" error={pwMismatch ? m.settings.accountCard.passwordDialog.mismatch : undefined}>
            <Input id="acc-pw-confirm" type="password" autoComplete="new-password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={tokenOpen}
        onClose={() => { setTokenOpen(false); setFreshToken(null); }}
        title={m.settings.accountCard.tokenDialog.title}
        description={freshToken ? m.settings.accountCard.tokenDialog.descriptionFresh : m.settings.accountCard.tokenDialog.descriptionNew}
        size="sm"
        actions={
          freshToken ? (
            <Button variant="primary" onClick={() => { setTokenOpen(false); setFreshToken(null); }}>
              {m.common.done}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setTokenOpen(false)}>
                {m.common.cancel}
              </Button>
              <Button variant="primary" onClick={() => void createToken()} loading={busy}>
                {m.settings.accountCard.tokenDialog.create}
              </Button>
            </>
          )
        }
      >
        {freshToken ? (
          <div className="col gap-3">
            <div className="token-plain">{freshToken}</div>
            <div className="row">
              <Button size="sm" icon={<Copy size={13} />} onClick={() => void copy(freshToken)}>
                {m.common.copy}
              </Button>
              <span className="muted xs">
                {m.settings.accountCard.tokenDialog.usageBefore}
                <code>{m.settings.accountCard.tokenDialog.usageCode}</code>
              </span>
            </div>
          </div>
        ) : (
          <Field label={m.settings.accountCard.tokenDialog.label} htmlFor="acc-token-name">
            <Input id="acc-token-name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder={m.settings.accountCard.tokenDialog.placeholder} autoFocus />
          </Field>
        )}
      </Dialog>

      <ConfirmDialog
        open={revokeTokenId != null}
        onClose={() => setRevokeTokenId(null)}
        onConfirm={revokeTokenNow}
        title={m.settings.accountCard.revokeTokenDialog.title}
        description={m.settings.accountCard.revokeTokenDialog.description}
        confirmLabel={m.settings.accountCard.tokens.revoke}
        danger
        busy={busy}
      />

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={m.settings.accountCard.deleteDialog.title}
        description={m.settings.accountCard.deleteDialog.description}
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {m.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void deleteAccount()} loading={busy} disabled={hasPassword && !deletePw}>
              {m.settings.accountCard.deleteDialog.confirmButton}
            </Button>
          </>
        }
      >
        {hasPassword ? (
          <Field label={m.settings.accountCard.deleteDialog.passwordLabel} htmlFor="acc-del-pw">
            <Input id="acc-del-pw" type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} autoFocus />
          </Field>
        ) : (
          <p className="small">{auth.mailerConfigured ? m.settings.accountCard.deleteDialog.mailerNote : m.settings.accountCard.deleteDialog.noMailerNote}</p>
        )}
      </Dialog>
    </div>
  );
}
