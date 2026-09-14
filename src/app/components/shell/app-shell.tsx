"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Ellipsis, Languages, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { attentionTotal } from "@/app/lib/overview-types";
import { cx } from "@/app/lib/cx";
import { getTheme, setTheme, type Theme } from "@/app/lib/settings";
import { useMessages } from "@/i18n/client";
import { useOverview } from "../overview-context";
import { AssistantPill } from "../assistant-card";
import { CommandPalette } from "../command-palette";
import { LogoMark } from "./logo";
import { NAV, SETTINGS_NAV, TABBAR_HREFS, isActivePath } from "./nav";
import { useLangToggle } from "./use-lang-toggle";

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function useThemeCycle() {
  const m = useMessages();
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => setThemeState(getTheme()), []);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const cycle = () => {
    const next = THEME_NEXT[theme];
    setTheme(next);
    setThemeState(next);
  };
  return { theme, label: m.shell.themes[theme], Icon, cycle };
}

function ThemeButton() {
  const m = useMessages();
  const { label, Icon, cycle } = useThemeCycle();
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm topbar-icon" onClick={cycle} aria-label={m.shell.themeAria(label)} title={m.shell.themeTitle(label)}>
      <Icon size={16} aria-hidden />
    </button>
  );
}

// The button shows the current language's own name, so it reads as a status as much as a control.
function LangButton() {
  const { name, aria, title, toggle } = useLangToggle();
  return (
    <button type="button" className="btn btn-ghost btn-sm topbar-icon topbar-lang" onClick={toggle} aria-label={aria} title={title}>
      <Languages size={16} aria-hidden />
      <span className="topbar-lang-name">{name}</span>
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
  const m = useMessages();
  const pathname = usePathname();
  const { data } = useOverview();
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcut = useShortcutLabel();
  const { label: themeLabel, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  const langToggle = useLangToggle();

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
        <Link href="/" className="brand" aria-label={m.shell.home}>
          <LogoMark className="brand-mark" />
          <span className="brand-word">Sortie</span>
        </Link>

        <nav className="nav" aria-label={m.shell.mainNav}>
          {NAV.map((n) => {
            const active = isActivePath(pathname, n.href);
            const badge = badgeOf(n);
            return (
              <Link key={n.href} href={n.href} className={cx("nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                <span>{m.nav[n.key]}</span>
                {badge > 0 ? (
                  <span className="nav-badge" aria-label={m.shell.pending(badge)}>
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="topbar-right">
          <AssistantPill />
          <button type="button" className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label={m.shell.searchLabel} title={m.shell.searchTitle(shortcut)}>
            <Search size={14} aria-hidden />
            <span className="hide-mobile">{m.shell.search}</span>
            <kbd className="hide-mobile" suppressHydrationWarning>
              {shortcut}
            </kbd>
          </button>
          <span className="hide-mobile">
            <LangButton />
          </span>
          <span className="hide-mobile">
            <ThemeButton />
          </span>
          <Link
            href={SETTINGS_NAV.href}
            className={cx("btn btn-ghost btn-icon btn-sm topbar-icon hide-mobile", settingsActive && "is-active")}
            aria-label={m.shell.settings}
            title={m.shell.settings}
            aria-current={settingsActive ? "page" : undefined}
          >
            <Settings size={16} aria-hidden />
          </Link>
        </div>
      </header>

      <div className="content">
        <main>{children}</main>
      </div>

      <nav className="tabbar" aria-label={m.shell.mainNav}>
        {tabItems.map((n) => {
          const active = isActivePath(pathname, n.href);
          const Icon = n.icon;
          const badge = badgeOf(n);
          return (
            <Link key={n.href} href={n.href} className={cx("tab-item", active && "is-active")} aria-current={active ? "page" : undefined}>
              <Icon size={20} aria-hidden strokeWidth={active ? 2.2 : 1.8} />
              <span>{m.nav[n.key]}</span>
              {badge > 0 ? <span className="nav-badge">{badge}</span> : null}
            </Link>
          );
        })}
        <button type="button" className={cx("tab-item", moreActive && "is-active")} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <Ellipsis size={20} aria-hidden />
          <span>{m.shell.more}</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div className="mobile-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={m.shell.more}>
            {moreItems.map((n) => {
              const active = isActivePath(pathname, n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} className={cx("sheet-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                  <Icon size={18} aria-hidden />
                  <span>{m.nav[n.key]}</span>
                </Link>
              );
            })}
            <div className="sheet-sep" />
            <button type="button" className="sheet-item" onClick={langToggle.toggle} aria-label={langToggle.aria}>
              <Languages size={18} aria-hidden />
              <span>{langToggle.title}</span>
            </button>
            <button type="button" className="sheet-item" onClick={cycleTheme}>
              <ThemeIcon size={18} aria-hidden />
              <span>{m.shell.themeTitle(themeLabel)}</span>
            </button>
            <Link href={SETTINGS_NAV.href} className={cx("sheet-item", settingsActive && "is-active")}>
              <Settings size={18} aria-hidden />
              <span>{m.shell.settings}</span>
            </Link>
          </div>
        </>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
