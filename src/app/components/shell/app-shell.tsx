"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Ellipsis, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { attentionTotal } from "@/app/lib/overview-types";
import { cx } from "@/app/lib/cx";
import { getTheme, setTheme, type Theme } from "@/app/lib/settings";
import { useOverview } from "../overview-context";
import { AssistantPill } from "../assistant-card";
import { CommandPalette } from "../command-palette";
import { LogoMark } from "./logo";
import { NAV, SETTINGS_NAV, TABBAR_HREFS, isActivePath } from "./nav";

const THEME_LABEL: Record<Theme, string> = { light: "浅色", dark: "深色", system: "跟随系统" };
const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function useThemeCycle() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => setThemeState(getTheme()), []);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const cycle = () => {
    const next = THEME_NEXT[theme];
    setTheme(next);
    setThemeState(next);
  };
  return { theme, label: THEME_LABEL[theme], Icon, cycle };
}

function ThemeButton() {
  const { label, Icon, cycle } = useThemeCycle();
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm topbar-icon" onClick={cycle} aria-label={`外观:${label},点击切换`} title={`外观 · ${label}`}>
      <Icon size={16} aria-hidden />
    </button>
  );
}

function useShortcutLabel(): string {
  const [label, setLabel] = useState("Ctrl K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setLabel("⌘K");
  }, []);
  return label;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useOverview();
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcut = useShortcutLabel();
  const { label: themeLabel, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();

  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const counts = data?.counts;
  const badges = {
    attention: counts ? attentionTotal(counts) : 0,
    network: counts ? counts.networkDrafts + counts.networkPendingSend : 0,
  };
  const badgeOf = (n: (typeof NAV)[number]) => (n.badge ? badges[n.badge] : 0);
  const settingsActive = isActivePath(pathname, SETTINGS_NAV.href);
  const tabItems = NAV.filter((n) => TABBAR_HREFS.includes(n.href));
  const moreItems = NAV.filter((n) => !TABBAR_HREFS.includes(n.href));
  const moreActive = moreItems.some((n) => isActivePath(pathname, n.href)) || settingsActive;

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Sortie 首页">
          <LogoMark className="brand-mark" />
          <span className="brand-word">Sortie</span>
        </Link>

        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => {
            const active = isActivePath(pathname, n.href);
            const badge = badgeOf(n);
            return (
              <Link key={n.href} href={n.href} className={cx("nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                <span>{n.label}</span>
                {badge > 0 ? (
                  <span className="nav-badge" aria-label={`${badge} 项待处理`}>
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="topbar-right">
          <AssistantPill />
          <button type="button" className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label="搜索与跳转" title={`搜索与跳转 (${shortcut})`}>
            <Search size={14} aria-hidden />
            <span className="hide-mobile">搜索</span>
            <kbd className="hide-mobile" suppressHydrationWarning>
              {shortcut}
            </kbd>
          </button>
          <span className="hide-mobile">
            <ThemeButton />
          </span>
          <Link
            href={SETTINGS_NAV.href}
            className={cx("btn btn-ghost btn-icon btn-sm topbar-icon hide-mobile", settingsActive && "is-active")}
            aria-label="设置"
            title="设置"
            aria-current={settingsActive ? "page" : undefined}
          >
            <Settings size={16} aria-hidden />
          </Link>
        </div>
      </header>

      <div className="content">
        <main>{children}</main>
      </div>

      <nav className="tabbar" aria-label="主导航">
        {tabItems.map((n) => {
          const active = isActivePath(pathname, n.href);
          const Icon = n.icon;
          const badge = badgeOf(n);
          return (
            <Link key={n.href} href={n.href} className={cx("tab-item", active && "is-active")} aria-current={active ? "page" : undefined}>
              <Icon size={20} aria-hidden strokeWidth={active ? 2.2 : 1.8} />
              <span>{n.label}</span>
              {badge > 0 ? <span className="nav-badge">{badge}</span> : null}
            </Link>
          );
        })}
        <button type="button" className={cx("tab-item", moreActive && "is-active")} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <Ellipsis size={20} aria-hidden />
          <span>更多</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div className="mobile-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="更多">
            {moreItems.map((n) => {
              const active = isActivePath(pathname, n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} className={cx("sheet-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                  <Icon size={18} aria-hidden />
                  <span>{n.label}</span>
                </Link>
              );
            })}
            <div className="sheet-sep" />
            <button type="button" className="sheet-item" onClick={cycleTheme}>
              <ThemeIcon size={18} aria-hidden />
              <span>外观 · {themeLabel}</span>
            </button>
            <Link href={SETTINGS_NAV.href} className={cx("sheet-item", settingsActive && "is-active")}>
              <Settings size={18} aria-hidden />
              <span>设置</span>
            </Link>
          </div>
        </>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
