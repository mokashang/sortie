"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/queue", label: "职位" },
  { href: "/apply", label: "投递" },
  { href: "/history", label: "历史" },
  { href: "/network", label: "人脉" },
  { href: "/profile", label: "Profile" },
  { href: "/studio", label: "Studio" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(l.href + "/");
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
