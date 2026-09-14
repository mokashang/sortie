"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cx } from "@/app/lib/cx";
import { Button, IconButton } from "./button";
import { Field, Input, Textarea } from "./field";
import { useMessages } from "@/i18n/client";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

// Native <dialog>: showModal() gives us the focus trap, Esc and the ::backdrop for free.
export function Dialog({ open, onClose, title, description, children, actions, size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const m = useMessages();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      document.body.classList.add("no-scroll");
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => () => document.body.classList.remove("no-scroll"), []);

  return (
    <dialog
      ref={ref}
      className={cx("dialog", size === "lg" && "dialog-lg", size === "sm" && "dialog-sm")}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => document.body.classList.remove("no-scroll")}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
      aria-labelledby="dialog-title"
    >
      {open ? (
        <div className="dialog-inner">
          <div className="dialog-head">
            <div className="grow">
              <div className="dialog-title" id="dialog-title">{title}</div>
              {description ? <div className="dialog-desc">{description}</div> : null}
            </div>
            <IconButton label={m.ui.close} icon={<X size={16} />} onClick={onClose} />
          </div>
          {children ? <div className="dialog-body">{children}</div> : null}
          {actions ? <div className="dialog-actions">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, danger, busy }: ConfirmDialogProps) {
  const m = useMessages();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {m.ui.cancel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => void onConfirm()} loading={busy} autoFocus>
            {confirmLabel ?? m.ui.confirm}
          </Button>
        </>
      }
    />
  );
}

export interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
  title: React.ReactNode;
  description?: React.ReactNode;
  label?: React.ReactNode;
  placeholder?: string;
  submitLabel?: string;
  optional?: boolean;
  multiline?: boolean;
  busy?: boolean;
  initial?: string;
}

export function PromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  optional = true,
  multiline = false,
  busy,
  initial = "",
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const m = useMessages();
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const canSubmit = optional || value.trim().length > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {m.ui.cancel}
          </Button>
          <Button variant="primary" onClick={() => void onSubmit(value.trim())} disabled={!canSubmit} loading={busy}>
            {submitLabel ?? m.ui.submit}
          </Button>
        </>
      }
    >
      <Field label={label} hint={optional ? m.ui.optional : undefined} htmlFor="prompt-input">
        {multiline ? (
          <Textarea id="prompt-input" rows={3} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
        ) : (
          <Input
            id="prompt-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                void onSubmit(value.trim());
              }
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}
