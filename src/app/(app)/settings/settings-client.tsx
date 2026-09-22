"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, Database, ExternalLink, Globe, Languages, Mail, MessageCircleQuestionMark, Monitor, Moon, RefreshCw, Sun, Zap } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import type { InboxStatus, MailboxStatus } from "@/inbox/sync";
import { getChannel, getTheme, setChannel, setTheme, type Channel, type Theme } from "@/app/lib/settings";
import { relativeTime } from "@/app/lib/time";
import { Button, Chip, ConfirmDialog, LinkButton, RadioCard, Section, Segmented, useToast } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { useLang, useMessages, useSetLang } from "@/i18n/client";
import { LANGS, LANG_NAME, type Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import type { AuthPublicConfig } from "@/lib/auth";
import { AccountCard, type AccountInfo } from "./account-card";
import type { AiProvider, AiProviderStatus } from "@/ai/config";
import type { ChatProvider } from "@/assistant/provider";

export interface LastTick {
  at: string;
  boards: number;
  inserted: number;
  errors: number;
}

export function SettingsClient({
  ntfyConfigured,
  lastTick,
  account,
  auth,
  ai,
  autoSubmit: autoSubmitInitial,
  chatProvider: chatProviderInitial,
  inbox: inboxInitial,
}: {
  ntfyConfigured: boolean;
  lastTick: LastTick | null;
  account: AccountInfo;
  auth: AuthPublicConfig;
  ai: { provider: AiProvider; providers: AiProviderStatus[] };
  autoSubmit: boolean;
  chatProvider: ChatProvider;
  inbox: InboxStatus;
}) {
  const m = useMessages();
  const lang = useLang();
  const setLang = useSetLang();
  const [channel, setChannelState] = useState<Channel>("user_chrome");
  const [theme, setThemeState] = useState<Theme>("system");
  const [opening, setOpening] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>(ai.provider);
  const [savingAi, setSavingAi] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState<boolean>(autoSubmitInitial);
  const [savingAutoSubmit, setSavingAutoSubmit] = useState(false);
  const [chatProvider, setChatProvider] = useState<ChatProvider>(chatProviderInitial);
  const [savingChat, setSavingChat] = useState(false);
  const [inbox, setInbox] = useState<InboxStatus>(inboxInitial);
  // What is in flight: "add" (leaving for Google), "sync:<id>" / "sync:all", "disconnect:<id>".
  const [inboxBusy, setInboxBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<MailboxStatus | null>(null);
  const connectHandled = useRef(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    setChannelState(getChannel());
    setThemeState(getTheme());
  }, []);

  // Back from Google's consent page (the callback route redirects to /settings?inbox=connected
  // &email=… or ?inbox=error&reason=…): show the outcome once, then drop the query.
  useEffect(() => {
    if (connectHandled.current || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get("inbox");
    if (!outcome) return;
    connectHandled.current = true;
    if (outcome === "connected") {
      toast({ title: m.inbox.settings.toast.connected(q.get("email") ?? ""), tone: "good" });
    } else {
      const reason = (q.get("reason") ?? "exchange") as keyof typeof m.inbox.connectError;
      toast({ title: m.inbox.settings.toast.connectFailed, description: m.inbox.connectError[reason] ?? m.inbox.connectError.exchange, tone: "danger" });
    }
    router.replace("/settings#inbox");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addMailbox() {
    setInboxBusy("add");
    window.location.assign("/api/inbox/google/start");
  }

  async function syncInbox(accountId?: number) {
    setInboxBusy(accountId != null ? `sync:${accountId}` : "sync:all");
    try {
      const r = await postJson<{ ok: boolean; summaries: { fetched: number; applied: number; error: string | null }[]; status: InboxStatus }>("/api/inbox/sync", accountId != null ? { accountId } : {});
      setInbox(r.status);
      const failed = r.summaries.find((s) => s.error);
      if (failed) toast({ title: m.inbox.settings.toast.syncFailed, description: failed.error ?? "", tone: "danger" });
      else {
        const fetched = r.summaries.reduce((n, s) => n + s.fetched, 0);
        const applied = r.summaries.reduce((n, s) => n + s.applied, 0);
        toast({ title: m.inbox.settings.toast.synced(fetched, applied), tone: "good" });
      }
      router.refresh();
    } catch (e) {
      toast({ title: m.inbox.settings.toast.syncFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setInboxBusy(null);
    }
  }

  async function disconnectInbox(box: MailboxStatus) {
    setInboxBusy(`disconnect:${box.id}`);
    try {
      const r = await postJson<{ status: InboxStatus }>("/api/inbox/disconnect", { accountId: box.id });
      setInbox(r.status);
      setConfirmDisconnect(null);
      toast({ title: m.inbox.settings.toast.disconnected, tone: "neutral" });
    } catch (e) {
      toast({ title: m.inbox.settings.toast.disconnectFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setInboxBusy(null);
    }
  }

  function chooseChannel(v: string) {
    const c = v === "headless" ? "headless" : "user_chrome";
    setChannel(c);
    setChannelState(c);
    toast({ title: c === "user_chrome" ? m.settings.channel.toastUserChrome : m.settings.channel.toastHeadless, tone: "good" });
  }

  function chooseTheme(t: Theme) {
    setTheme(t);
    setThemeState(t);
  }

  async function chooseLang(next: Lang) {
    if (next === lang) return;
    await setLang(next);
    // The toast is worded in the language just chosen, not the one being left.
    toast({ title: messages[next].settings.language.switched, tone: "good" });
  }

  async function openProfile() {
    setOpening(true);
    try {
      await postJson("/api/executor/open-profile");
      toast({ title: m.settings.channel.openedTitle, description: m.settings.channel.openedDescription, tone: "good", duration: 8000 });
    } catch (e) {
      toast({ title: m.settings.channel.openFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setOpening(false);
    }
  }

  async function chooseAiProvider(value: string) {
    const next = value as AiProvider;
    if (next === aiProvider || savingAi) return;
    const previous = aiProvider;
    setAiProvider(next);
    setSavingAi(true);
    try {
      await postJson("/api/settings", { provider: next });
      toast({ title: m.settings.ai.switched(m.settings.ai.providers[next].title), tone: "good" });
    } catch (e) {
      setAiProvider(previous);
      toast({ title: m.settings.ai.switchFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setSavingAi(false);
    }
  }

  async function chooseAutoSubmit(value: string) {
    const next = value === "auto";
    if (next === autoSubmit || savingAutoSubmit) return;
    const previous = autoSubmit;
    setAutoSubmit(next);
    setSavingAutoSubmit(true);
    try {
      await postJson("/api/settings/auto-submit", { enabled: next });
      toast({ title: next ? m.settings.autoSubmit.toastOn : m.settings.autoSubmit.toastOff, tone: "good" });
    } catch (e) {
      setAutoSubmit(previous);
      toast({ title: m.settings.autoSubmit.saveFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setSavingAutoSubmit(false);
    }
  }

  async function chooseChatProvider(value: ChatProvider) {
    if (value === chatProvider || savingChat) return;
    const previous = chatProvider;
    setChatProvider(value);
    setSavingChat(true);
    try {
      await postJson("/api/settings/chat-provider", { provider: value });
      toast({ title: m.settings.chat.switched(value === "claude" ? m.settings.chat.claude : m.settings.ai.providers[aiProvider].title), tone: "good" });
    } catch (e) {
      setChatProvider(previous);
      toast({ title: m.settings.chat.switchFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setSavingChat(false);
    }
  }

  return (
    <>
      <Section id="account" title={m.settings.account.title} description={m.settings.account.description}>
        <AccountCard account={account} auth={auth} />
      </Section>

      <Section title={m.settings.channel.title} description={m.settings.channel.description}>
        <div className="col gap-3" style={{ maxWidth: 640 }}>
          <RadioCard
            name="channel"
            value="user_chrome"
            checked={channel === "user_chrome"}
            onChange={chooseChannel}
            title={
              <span className="row gap-1">
                <Globe size={15} aria-hidden /> {m.settings.channel.userChrome} <Chip tone="good">{m.settings.channel.recommended}</Chip>
              </span>
            }
            description={m.settings.channel.userChromeDescription}
          />
          <RadioCard
            name="channel"
            value="headless"
            checked={channel === "headless"}
            onChange={chooseChannel}
            title={m.settings.channel.headless}
            description={m.settings.channel.headlessDescription}
          >
            <div className="row">
              <Button size="sm" onClick={openProfile} loading={opening} icon={<ExternalLink size={13} />}>
                {m.settings.channel.openProfile}
              </Button>
              <span className="muted xs">{m.settings.channel.openProfileHint}</span>
            </div>
          </RadioCard>
        </div>
      </Section>

      <Section id="auto-submit" title={m.settings.autoSubmit.title} description={m.settings.autoSubmit.description}>
        <div className="col gap-3" style={{ maxWidth: 640 }} aria-busy={savingAutoSubmit}>
          <RadioCard
            name="auto-submit"
            value="manual"
            checked={!autoSubmit}
            onChange={(value) => void chooseAutoSubmit(value)}
            title={m.settings.autoSubmit.manual}
            description={m.settings.autoSubmit.manualDescription}
          />
          <RadioCard
            name="auto-submit"
            value="auto"
            checked={autoSubmit}
            onChange={(value) => void chooseAutoSubmit(value)}
            title={
              <span className="row gap-1">
                <Zap size={15} aria-hidden /> {m.settings.autoSubmit.auto}
                {autoSubmit ? <Chip tone="good">{m.settings.autoSubmit.on}</Chip> : null}
              </span>
            }
            description={m.settings.autoSubmit.autoDescription}
          />
        </div>
      </Section>

      <Section id="inbox" title={m.inbox.settings.title} description={m.inbox.settings.description}>
        <div className="col gap-3">
          {inbox.mailboxes.length === 0 ? (
            <div className="row">
              <Mail size={15} aria-hidden className="muted" />
              <span className="muted">{m.inbox.settings.none}</span>
            </div>
          ) : (
            inbox.mailboxes.map((box) => (
              <div key={box.id} className="col gap-1">
                <div className="row">
                  <Mail size={15} aria-hidden className="muted" />
                  <span className="strong">{box.email}</span>
                  {box.lastError ? <Chip tone="danger">{m.inbox.settings.toast.syncFailed}</Chip> : null}
                </div>
                <div className="muted small">
                  {box.syncedAt ? m.inbox.settings.lastSync(relativeTime(box.syncedAt, lang)) : m.inbox.settings.neverSynced}
                  {" · "}
                  {m.inbox.settings.counts(box.events.total, box.events.matched, box.events.applied)}
                </div>
                {box.lastError ? (
                  <div className="small text-danger">
                    {m.inbox.settings.error(box.lastError)}
                    {box.lastError.startsWith("reconnect needed") ? <> {m.inbox.settings.reconnectHint}</> : null}
                  </div>
                ) : null}
                <div className="row">
                  <Button size="sm" onClick={() => void syncInbox(box.id)} loading={inboxBusy === `sync:${box.id}`} disabled={inboxBusy !== null} icon={<RefreshCw size={13} />}>
                    {inboxBusy === `sync:${box.id}` ? m.inbox.settings.syncing : m.inbox.settings.syncNow}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(box)} disabled={inboxBusy !== null}>
                    {m.inbox.settings.disconnect}
                  </Button>
                </div>
              </div>
            ))
          )}
          {auth.googleEnabled ? (
            <div className="row">
              <Button size="sm" variant={inbox.mailboxes.length === 0 ? "primary" : "secondary"} onClick={addMailbox} loading={inboxBusy === "add"} disabled={inboxBusy !== null}>
                {m.inbox.settings.add}
              </Button>
              {inbox.mailboxes.length > 1 ? (
                <Button size="sm" variant="ghost" onClick={() => void syncInbox()} loading={inboxBusy === "sync:all"} disabled={inboxBusy !== null} icon={<RefreshCw size={13} />}>
                  {m.inbox.settings.syncAll}
                </Button>
              ) : null}
              <span className="muted xs">{m.inbox.settings.addHint}</span>
            </div>
          ) : (
            <p className="muted small">{m.inbox.settings.needGoogle}</p>
          )}
        </div>
        <ConfirmDialog
          open={confirmDisconnect !== null}
          onClose={() => setConfirmDisconnect(null)}
          onConfirm={() => {
            if (confirmDisconnect) void disconnectInbox(confirmDisconnect);
          }}
          title={confirmDisconnect ? m.inbox.settings.disconnectConfirmTitle(confirmDisconnect.email) : ""}
          description={m.inbox.settings.disconnectConfirmDescription}
          confirmLabel={m.inbox.settings.disconnect}
          danger
          busy={confirmDisconnect !== null && inboxBusy === `disconnect:${confirmDisconnect.id}`}
        />
      </Section>

      <Section title={m.settings.ai.title} description={m.settings.ai.description}>
        <div className="col gap-3" style={{ maxWidth: 640 }} aria-busy={savingAi}>
          {(["codex", "gpt", "claude"] as AiProvider[]).map((provider) => {
            const status = ai.providers.find((item) => item.provider === provider);
            const copy = m.settings.ai.providers[provider];
            return (
              <RadioCard
                key={provider}
                name="ai-provider"
                value={provider}
                checked={aiProvider === provider}
                onChange={(value) => void chooseAiProvider(value)}
                title={
                  <span className="row gap-1">
                    <Bot size={15} aria-hidden /> {copy.title}
                    {provider === "codex" ? <Chip tone="good">{m.settings.ai.recommended}</Chip> : null}
                    {!status?.configured ? <Chip tone="warn">{m.settings.ai.notConfigured}</Chip> : null}
                  </span>
                }
                description={
                  <>
                    {copy.description}
                    {!status?.configured && status?.reason ? (
                      <>
                        <br />
                        <code>{status.reason}</code>
                      </>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </div>
      </Section>

      <Section title={m.settings.chat.title} description={m.settings.chat.description}>
        <div className="col gap-3" style={{ maxWidth: 640 }} aria-busy={savingChat}>
          <RadioCard
            name="chat-provider"
            value="claude"
            checked={chatProvider === "claude"}
            onChange={(v) => void chooseChatProvider(v as ChatProvider)}
            title={
              <span className="row gap-1">
                <MessageCircleQuestionMark size={15} aria-hidden /> {m.settings.chat.claude}
              </span>
            }
            description={m.settings.chat.claudeDescription}
          />
          <RadioCard
            name="chat-provider"
            value="follow"
            checked={chatProvider === "follow"}
            onChange={(v) => void chooseChatProvider(v as ChatProvider)}
            title={
              <span className="row gap-1">
                <Bot size={15} aria-hidden /> {m.settings.chat.follow} · {m.settings.ai.providers[aiProvider].title}
              </span>
            }
            description={m.settings.chat.followDescription}
          />
        </div>
      </Section>

      <Section title={m.settings.language.title} description={m.settings.language.description}>
        <Segmented<Lang>
          ariaLabel={m.settings.language.title}
          value={lang}
          onChange={(v) => void chooseLang(v)}
          options={LANGS.map((l) => ({
            value: l,
            label: (
              <span className="row gap-1 row-nowrap" lang={l === "zh" ? "zh-CN" : "en"}>
                <Languages size={13} aria-hidden /> {LANG_NAME[l]}
              </span>
            ),
          }))}
        />
      </Section>

      <Section title={m.settings.theme.title}>
        <Segmented<Theme>
          ariaLabel={m.settings.theme.title}
          value={theme}
          onChange={chooseTheme}
          options={[
            {
              value: "light",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Sun size={13} aria-hidden /> {m.settings.theme.light}
                </span>
              ),
            },
            {
              value: "dark",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Moon size={13} aria-hidden /> {m.settings.theme.dark}
                </span>
              ),
            },
            {
              value: "system",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Monitor size={13} aria-hidden /> {m.settings.theme.system}
                </span>
              ),
            },
          ]}
        />
      </Section>

      <Section title={m.settings.notifications.title} description={m.settings.notifications.description}>
        <div className="row">
          <Bell size={15} aria-hidden className="muted" />
          <span>{m.settings.notifications.phonePush}</span>
          {ntfyConfigured ? <Chip tone="good">{m.settings.notifications.configured}</Chip> : <Chip tone="warn">{m.settings.notifications.notConfigured}</Chip>}
        </div>
        {!ntfyConfigured ? (
          <p className="muted small mt-2">
            {m.settings.notifications.howTo.before}
            <code>{m.settings.notifications.howTo.env}</code>
            {m.settings.notifications.howTo.middle}
            <code>{m.settings.notifications.howTo.key}</code>
            {m.settings.notifications.howTo.after}
          </p>
        ) : null}
      </Section>

      <Section title={m.settings.sources.title} description={m.settings.sources.description}>
        <div className="row">
          <Database size={15} aria-hidden className="muted" />
          {lastTick ? (
            <span className="small">
              {m.settings.sources.lastTick(relativeTime(lastTick.at, lang), lastTick.boards, lastTick.inserted)}
              {lastTick.errors > 0 ? <span className="text-danger">{m.settings.sources.errors(lastTick.errors)}</span> : null}
              {m.settings.sources.period}
            </span>
          ) : (
            <span className="muted small">{m.settings.sources.noTick}</span>
          )}
        </div>
        <div className="row mt-3">
          <ScanMenu />
          <LinkButton href="/sources" variant="ghost" icon={<ExternalLink size={13} />}>
            {m.settings.sources.advanced}
          </LinkButton>
        </div>
      </Section>
    </>
  );
}
