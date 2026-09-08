import { forwardRef } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { cx } from "@/app/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, loading && "is-loading", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="btn-spin" size={14} aria-hidden /> : icon ? <span aria-hidden>{icon}</span> : null}
      {children != null && children !== false ? <span>{children}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "children"> {
  label: string;
  icon: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "ghost", size = "sm", className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx("btn", "btn-icon", `btn-${variant}`, `btn-${size}`, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
});

export interface LinkButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  external?: boolean;
}

export function LinkButton({ href, variant = "secondary", size = "md", icon, external, className, children, ...rest }: LinkButtonProps) {
  const cls = cx("btn", `btn-${variant}`, `btn-${size}`, className);
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer" {...rest}>
        {icon ? <span aria-hidden>{icon}</span> : null}
        <span>{children}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span>{children}</span>
    </Link>
  );
}
