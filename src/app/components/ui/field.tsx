"use client";
import { forwardRef, useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { cx } from "@/app/lib/cx";
import { useMessages } from "@/i18n/client";

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, htmlFor, inline, className, children }: FieldProps) {
  return (
    <div className={cx("field", inline && "field-inline", className)}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { size?: never; small?: boolean }>(
  function Input({ className, small, ...rest }, ref) {
    return <input ref={ref} className={cx("input", small && "input-sm", className)} {...rest} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }>(function Select(
  { className, small, ...rest },
  ref
) {
  return <select ref={ref} className={cx("select", small && "select-sm", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean }>(
  function Textarea({ className, autoGrow, onChange, ...rest }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    function setRefs(el: HTMLTextAreaElement | null) {
      inner.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    }
    function grow(el: HTMLTextAreaElement | null) {
      if (!el || !autoGrow) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }
    useEffect(() => {
      grow(inner.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rest.value, autoGrow]);
    return (
      <textarea
        ref={setRefs}
        className={cx("textarea", className)}
        onChange={(e) => {
          grow(e.currentTarget);
          onChange?.(e);
        }}
        {...rest}
      />
    );
  }
);

export interface StepperProps {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function Stepper({ value, min = 0, max, onChange, disabled, ariaLabel }: StepperProps) {
  const m = useMessages();
  const clamp = (n: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.floor(n) : min));
  return (
    <div className={cx("stepper", value === 0 && "is-zero", disabled && "is-disabled")}>
      <button type="button" aria-label={m.ui.stepperMinus(ariaLabel)} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus size={13} aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" aria-label={m.ui.stepperPlus(ariaLabel)} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}

export function Checkbox({ label, className, ...input }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cx("checkbox", className)}>
      <input type="checkbox" {...input} />
      <span>{label}</span>
    </label>
  );
}

export interface RadioCardProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

export function RadioCard({ name, value, checked, onChange, title, description, children }: RadioCardProps) {
  return (
    <label className={cx("radio-card", checked && "is-checked")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <div className="grow">
        <div className="radio-card-title">{title}</div>
        {description ? <div className="radio-card-desc">{description}</div> : null}
        {checked && children ? <div className="radio-card-body">{children}</div> : null}
      </div>
    </label>
  );
}
