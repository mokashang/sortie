import Link from "next/link";
import { cx } from "@/app/lib/cx";
import { Tooltip } from "./tooltip";

export interface StatProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent" | "good" | "warn";
  hint?: string;
  href?: string;
}

export function Stat({ label, value, sub, tone, hint, href }: StatProps) {
  const body = (
    <>
      <div className="stat-label">
        {label}
        {hint ? <Tooltip content={hint} /> : null}
      </div>
      <div className={cx("stat-value", tone && `is-${tone}`)}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="stat">
        {body}
      </Link>
    );
  }
  return <div className="stat">{body}</div>;
}

export function StatStrip({ children, className, compact }: { children: React.ReactNode; className?: string; compact?: boolean }) {
  return <div className={cx("stat-strip", compact && "stat-strip-compact", className)}>{children}</div>;
}
