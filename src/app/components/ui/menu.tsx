"use client";
import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { cx } from "@/app/lib/cx";
import { IconButton, Button, ButtonVariant, ButtonSize } from "./button";

export interface MenuItem {
  label: React.ReactNode;
  onSelect: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

export type MenuEntry = MenuItem | "sep";

export interface MenuProps {
  items: MenuEntry[];
  label?: string;
  icon?: React.ReactNode;
  align?: "start" | "end";
  size?: ButtonSize;
  variant?: ButtonVariant;
  // Text trigger instead of the ⋯ icon button.
  text?: React.ReactNode;
  disabled?: boolean;
  // Fully custom trigger element; receives the props it must spread onto its button.
  trigger?: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; disabled?: boolean }) => React.ReactNode;
}

export function Menu({ items, label = "更多", icon, align = "end", size = "sm", variant = "ghost", text, disabled, trigger }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>("button")?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(list.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? []);
        if (els.length === 0) return;
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? els[(i + 1) % els.length] : els[(i - 1 + els.length) % els.length];
        next?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    list.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const r = wrap.current?.getBoundingClientRect();
      setUp(!!r && window.innerHeight - r.bottom < 40 + items.length * 36);
    }
    setOpen((o) => !o);
  }

  return (
    <div className="menu" ref={wrap} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {trigger ? (
        trigger({ onClick: toggle, "aria-expanded": open, "aria-haspopup": "menu", disabled })
      ) : text != null ? (
        <Button variant={variant} size={size} onClick={toggle} aria-expanded={open} aria-haspopup="menu" disabled={disabled} icon={icon}>
          {text}
        </Button>
      ) : (
        <IconButton
          label={label}
          icon={icon ?? <Ellipsis size={16} />}
          variant={variant}
          size={size}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
        />
      )}
      {open ? (
        <div className={cx("menu-list", align === "start" && "is-start", up && "is-up")} role="menu" ref={list}>
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={`sep-${i}`} className="menu-sep" role="separator" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cx("menu-item", it.danger && "is-danger")}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon ? <span aria-hidden>{it.icon}</span> : null}
                {it.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
