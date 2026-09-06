import { cx } from "@/app/lib/cx";

export interface CardProps {
  tone?: "default" | "warn" | "accent" | "good";
  flush?: boolean;
  className?: string;
  id?: string;
  children: React.ReactNode;
}

export function Card({ tone = "default", flush = false, className, id, children }: CardProps) {
  return (
    <div id={id} className={cx("card", tone !== "default" && `card-${tone}`, flush && "card-flush", className)}>
      {children}
    </div>
  );
}

export interface SectionProps {
  title: React.ReactNode;
  count?: number;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}

// The 制版间 panel: a top ink rule and a small-caps title, no box.
export function Section({ title, count, description, actions, className, id, children }: SectionProps) {
  return (
    <section id={id} className={cx("section", className)}>
      <div className="section-head">
        <h2 className="section-title">
          {title}
          {count != null ? <span className="section-count">{count}</span> : null}
        </h2>
        {actions ? <div className="section-actions">{actions}</div> : null}
        {description ? <p className="section-desc">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
