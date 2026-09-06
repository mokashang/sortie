"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./button";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headExtra?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Right-side sheet (full-screen on phones). Traps focus, closes on Esc/backdrop, restores focus.
export function Drawer({ open, onClose, title, subtitle, headExtra, children, footer, width = 560 }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.classList.add("no-scroll");
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (el?.querySelector<HTMLElement>(".drawer-body") ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        style={{ "--drawer-w": `${width}px` } as React.CSSProperties}
      >
        <div className="drawer-head">
          <div className="grow">
            <div className="drawer-title" id="drawer-title">{title}</div>
            {subtitle ? <div className="drawer-subtitle">{subtitle}</div> : null}
            {headExtra ? <div className="mt-2">{headExtra}</div> : null}
          </div>
          <IconButton label="关闭" icon={<X size={16} />} onClick={onClose} />
        </div>
        <div className="drawer-body" tabIndex={-1}>
          {children}
        </div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}
