import { Inbox, Briefcase, Send, History, Users, UserRound, ChartColumn, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Which live count from /api/overview shows as a badge next to the label.
  badge?: "attention" | "network";
}

export const NAV: NavItem[] = [
  { href: "/", label: "今日", icon: Inbox },
  { href: "/queue", label: "职位", icon: Briefcase },
  { href: "/apply", label: "投递", icon: Send, badge: "attention" },
  { href: "/history", label: "历史", icon: History },
  { href: "/network", label: "人脉", icon: Users, badge: "network" },
  { href: "/profile", label: "档案", icon: UserRound },
  { href: "/dashboard", label: "统计", icon: ChartColumn },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "设置", icon: Settings };

// The phone tab bar holds the four daily destinations; everything else sits behind 「更多」.
export const TABBAR_HREFS = ["/", "/queue", "/apply", "/network"];

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
