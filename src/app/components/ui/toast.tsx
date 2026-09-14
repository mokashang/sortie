"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cx } from "@/app/lib/cx";
import type { Tone } from "@/app/lib/labels";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (o: ToastOptions) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback(
    (o: ToastOptions) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-3), { ...o, id }]);
      const dur = o.duration ?? (o.action ? 8000 : 4000);
      timers.current.set(id, setTimeout(() => dismiss(id), dur));
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={cx("toast", t.tone && t.tone !== "neutral" && `toast-${t.tone}`)} role="status">
            <span className="toast-dot" aria-hidden />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.description ? <div className="toast-desc">{t.description}</div> : null}
            </div>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onClick();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => dismiss(t.id)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}
