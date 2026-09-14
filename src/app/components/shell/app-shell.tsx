"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu as MenuIcon, Monitor, Moon, Settings, Sun, UserRound, X } from "lucide-react";
import { attentionTotal } from "@/app/lib/overview-types";
import { cx } from "@/app/lib/cx";
import { getTheme, setTheme, type Theme } from "@/app/lib/settings";
import { authClient } from "@/lib/auth-client";
import { IconButton, Menu, useToast } from "@/app/components/ui";
import { useOverview } from "../overview-context";
import { AssistantPill } from "../assistant-card";
import { NAV, SETTINGS_NAV, isActivePath } from "./nav";

const THEME_LABEL: Record<Theme, string> = { light: "浅色", dark: "深色", system: "跟随系统" };
const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
}

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => setThemeState(getTheme()), []);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      className="nav-item"
      onClick={() => {
        const next = THEME_NEXT[theme];
        setTheme(next);
        setThemeState(next);
      }}
      aria-label={`外观:${THEME_LABEL[theme]},点击切换`}
    >
      <Icon size={17} aria-hidden />
      <span className="nav-label">外观 · {THEME_LABEL[theme]}</span>
    </button>
  );
}

function initials(name: string, email: string): string {
  const src = name.trim() || email;
  const first = [...src][0] ?? "?";
  return first.toUpperCase();
}

// The account chip at the foot of the sidebar: who is signed in, with 设置 / 退出登录.
function UserChip({ user }: { user: ShellUser }) {
  const router = useRouter();
  const { toast } = useToast();
  async function signOut() {
    const { error } = await authClient.signOut();
    if (error) {
      toast({ title: "退出失败", description: error.message ?? "", tone: "danger" });
      return;
    }
    router.push("/login");
    router.refresh();
  }
  return (
    <Menu
      align="start"
      items={[
        { label: "账号与设置", icon: <Settings size={14} />, onSelect: () => router.push("/settings#account") },
        { label: "我的档案", icon: <UserRound size={14} />, onSelect: () => router.push("/profile?tab=basics") },
        "sep",
        { label: "退出登录", icon: <LogOut size={14} />, onSelect: () => void signOut() },
      ]}
      trigger={(p) => (
        <button type="button" className="user-chip" title={user.email} {...p}>
          <span className="user-avatar" aria-hidden>
            {initials(user.name, user.email)}
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="user-chip-name truncate">{user.name || user.email}</span>
            <span className="user-chip-mail truncate">{user.email}</span>
          </span>
        </button>
      )}
    />
  );
}

export function AppShell({ children, user }: { children: React.ReactNode; user: ShellUser }) {
  const pathname = usePathname();
  const { data } = useOverview();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const counts = data?.counts;
  const badges = {
    attention: counts ? attentionTotal(counts) : 0,
    network: counts ? counts.networkDrafts + counts.networkPendingSend : 0,
  };
  const current = [...NAV, SETTINGS_NAV].find((n) => isActivePath(pathname, n.href));

  const navList = (
    <nav className="nav" aria-label="主导航">
      {NAV.map((n) => {
        const active = isActivePath(pathname, n.href);
        const Icon = n.icon;
        const badge = n.badge ? badges[n.badge] : 0;
        return (
          <Link key={n.href} href={n.href} className={cx("nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
            <Icon size={17} aria-hidden />
            <span className="nav-label">{n.label}</span>
            {badge > 0 ? (
              <span className="nav-badge" aria-label={`${badge} 项待处理`}>
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const settingsActive = isActivePath(pathname, SETTINGS_NAV.href);
  const foot = (
    <div className="sidebar-foot">
      <AssistantPill />
      <ThemeToggle />
      <Link href={SETTINGS_NAV.href} className={cx("nav-item", settingsActive && "is-active")} aria-current={settingsActive ? "page" : undefined}>
        <SETTINGS_NAV.icon size={17} aria-hidden />
        <span className="nav-label">{SETTINGS_NAV.label}</span>
      </Link>
      <UserChip user={user} />
    </div>
  );

  const brand = (
    <Link href="/" className="brand">
      Sortie <span className="brand-tag">求职助手</span>
    </Link>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        {brand}
        {navList}
        {foot}
      </aside>
      <div className="content">
        <header className="topbar">
          <IconButton label="打开导航" icon={<MenuIcon size={18} />} onClick={() => setNavOpen(true)} />
          <span className="topbar-title">{current?.label ?? ""}</span>
          <Link href="/" className="brand">
            Sortie
          </Link>
        </header>
        {navOpen ? (
          <>
            <div className="mobile-nav-backdrop" onClick={() => setNavOpen(false)} />
            <div className="mobile-nav" role="dialog" aria-modal="true" aria-label="导航">
              <div className="row between">
                {brand}
                <IconButton label="关闭导航" icon={<X size={18} />} onClick={() => setNavOpen(false)} />
              </div>
              {navList}
              {foot}
            </div>
          </>
        ) : null}
        <main>{children}</main>
      </div>
    </div>
  );
}
