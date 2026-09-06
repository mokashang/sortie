import { cx } from "@/app/lib/cx";
import type { Tone } from "@/app/lib/labels";

export interface ChipProps {
  tone?: Tone;
  outline?: boolean;
  size?: "sm" | "md";
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

export function Chip({ tone = "neutral", outline = false, size = "sm", icon, title, className, children }: ChipProps) {
  return (
    <span className={cx("chip", `chip-${tone}`, outline && "chip-outline", size === "md" && "chip-md", className)} title={title}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}
