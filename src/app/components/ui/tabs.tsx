"use client";
import { useEffect, useRef } from "react";
import { cx } from "@/app/lib/cx";

export interface TabItem {
  key: string;
  label: React.ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
}

export function Tabs({ items, value, onChange, ariaLabel, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(".tab.is-active");
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = items.findIndex((t) => t.key === value);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    if (next) {
      onChange(next.key);
      listRef.current?.querySelectorAll<HTMLElement>(".tab")[items.indexOf(next)]?.focus();
    }
  }

  return (
    <div className={cx("tabs", className)} role="tablist" aria-label={ariaLabel} ref={listRef} onKeyDown={onKeyDown}>
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx("tab", active && "is-active")}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {t.count != null ? <span className="tab-count">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
