import { Inbox, Briefcase, Send, History, Users, UserRound, ChartColumn, Settings, type LucideIcon } from "lucide-react";
import type { Messages } from "@/i18n/messages";

export type NavKey = keyof Messages["nav"];

export interface NavItem {
  href: string;
  // The label is messages.nav[key] in the current language.
  key: NavKey;
  icon: LucideIcon;
  // Which live count from /api/overview shows as a badge next to the label.
  badge?: "attention" | "network";
}

export const NAV: NavItem[] = [
  { href: "/", key: "today", icon: Inbox },
  { href: "/queue", key: "queue", icon: Briefcase },
  { href: "/apply", key: "apply", icon: Send, badge: "attention" },
  { href: "/history", key: "history", icon: History },
  { href: "/network", key: "network", icon: Users, badge: "network" },
  { href: "/profile", key: "profile", icon: UserRound },
  { href: "/dashboard", key: "dashboard", icon: ChartColumn },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", key: "settings", icon: Settings };

// The phone tab bar holds the four daily destinations; everything else sits behind 「更多」.
export const TABBAR_HREFS = ["/", "/queue", "/apply", "/network"];

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
