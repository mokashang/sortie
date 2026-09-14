"use client";
import { useEffect, useState } from "react";
import { Bell, Database, ExternalLink, Globe, Languages, Monitor, Moon, Sun } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { getChannel, getTheme, setChannel, setTheme, type Channel, type Theme } from "@/app/lib/settings";
import { relativeTime } from "@/app/lib/time";
import { Button, Chip, LinkButton, RadioCard, Section, Segmented, useToast } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { useLang, useMessages, useSetLang } from "@/i18n/client";
import { LANGS, LANG_NAME, type Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";

export interface LastTick {
  at: string;
  boards: number;
  inserted: number;
  errors: number;
}

export function SettingsClient({ ntfyConfigured, lastTick }: { ntfyConfigured: boolean; lastTick: LastTick | null }) {
  const m = useMessages();
  const lang = useLang();
  const setLang = useSetLang();
  const [channel, setChannelState] = useState<Channel>("user_chrome");
  const [theme, setThemeState] = useState<Theme>("system");
  const [opening, setOpening] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setChannelState(getChannel());
    setThemeState(getTheme());
  }, []);

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

  return (
    <>
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
