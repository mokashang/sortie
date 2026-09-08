"use client";
import { useEffect, useState } from "react";
import { Bell, Database, ExternalLink, Globe, Monitor, Moon, Sun } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { getChannel, getTheme, setChannel, setTheme, type Channel, type Theme } from "@/app/lib/settings";
import { relativeTime } from "@/app/lib/time";
import { Button, Chip, LinkButton, RadioCard, Section, Segmented, useToast } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";

export interface LastTick {
  at: string;
  boards: number;
  inserted: number;
  errors: number;
}

export function SettingsClient({ ntfyConfigured, lastTick }: { ntfyConfigured: boolean; lastTick: LastTick | null }) {
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
    toast({ title: c === "user_chrome" ? "之后的任务会在你的 Chrome 里操作" : "之后的任务会用后台浏览器", tone: "good" });
  }

  function chooseTheme(t: Theme) {
    setTheme(t);
    setThemeState(t);
  }

  async function openProfile() {
    setOpening(true);
    try {
      await postJson("/api/executor/open-profile");
      toast({ title: "已打开后台浏览器", description: "在弹出的窗口里登录一次 LinkedIn、Workday 等站点,登录状态会保留给之后的后台任务。", tone: "good", duration: 8000 });
    } catch (e) {
      toast({ title: "打开失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <Section title="执行方式" description="助手替你找人、填表时用哪个浏览器。">
        <div className="col gap-3" style={{ maxWidth: 640 }}>
          <RadioCard
            name="channel"
            value="user_chrome"
            checked={channel === "user_chrome"}
            onChange={chooseChannel}
            title={
              <span className="row gap-1">
                <Globe size={15} aria-hidden /> 在我的 Chrome 里操作 <Chip tone="good">推荐</Chip>
              </span>
            }
            description="用你已经登录好的 Chrome,你随时能看着它做。任务先排队:桌面应用里的 Claude 会话在线时由它接手,否则 App 自动拉起一个命令行会话(需要 claude 已登录)。"
          />
          <RadioCard
            name="channel"
            value="headless"
            checked={channel === "headless"}
            onChange={chooseChannel}
            title="后台浏览器(无人值守)"
            description="用一个独立、持久的浏览器档案在后台操作,不占用你的 Chrome;第一次使用前要在里面登录一次。不支持找内推。"
          >
            <div className="row">
              <Button size="sm" onClick={openProfile} loading={opening} icon={<ExternalLink size={13} />}>
                打开后台浏览器,登录一次
              </Button>
              <span className="muted xs">换了密码或登录失效时再点一次。</span>
            </div>
          </RadioCard>
        </div>
      </Section>

      <Section title="外观">
        <Segmented<Theme>
          ariaLabel="外观"
          value={theme}
          onChange={chooseTheme}
          options={[
            {
              value: "light",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Sun size={13} aria-hidden /> 浅色
                </span>
              ),
            },
            {
              value: "dark",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Moon size={13} aria-hidden /> 深色
                </span>
              ),
            },
            {
              value: "system",
              label: (
                <span className="row gap-1 row-nowrap">
                  <Monitor size={13} aria-hidden /> 跟随系统
                </span>
              ),
            },
          ]}
        />
      </Section>

      <Section title="通知" description="助手需要你确认或补信息时,会弹桌面通知;配置了手机推送就也会推到手机。">
        <div className="row">
          <Bell size={15} aria-hidden className="muted" />
          <span>手机推送</span>
          {ntfyConfigured ? <Chip tone="good">已配置</Chip> : <Chip tone="warn">未配置</Chip>}
        </div>
        {!ntfyConfigured ? (
          <p className="muted small mt-2">
            在项目根目录的 <code>.env</code> 里设置 <code>NTFY_TOPIC=</code> 一个自选的长随机名,并在手机的 ntfy 应用里订阅同名频道,然后重启 Sortie。
          </p>
        ) : null}
      </Section>

      <Section title="信息源" description="后台按层级自动轮询各公司的招聘系统,不需要你操心;这里只看最近一次的结果。">
        <div className="row">
          <Database size={15} aria-hidden className="muted" />
          {lastTick ? (
            <span className="small">
              上次检查 {relativeTime(lastTick.at)}:问了 {lastTick.boards} 个板块,新增 {lastTick.inserted} 个职位
              {lastTick.errors > 0 ? <span className="text-danger">,{lastTick.errors} 个出错</span> : null}。
            </span>
          ) : (
            <span className="muted small">还没有检查记录。</span>
          )}
        </div>
        <div className="row mt-3">
          <ScanMenu />
          <LinkButton href="/sources" variant="ghost" icon={<ExternalLink size={13} />}>
            信息源高级页
          </LinkButton>
        </div>
      </Section>
    </>
  );
}
