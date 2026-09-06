"use client";
import { cx } from "@/app/lib/cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "md", disabled }: SegmentedProps<T>) {
  return (
    <div className={cx("seg", size === "sm" && "seg-sm")} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={cx("seg-item", active && "is-active")}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {o.count != null ? <span className="tab-count">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
