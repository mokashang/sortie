import { cx } from "@/app/lib/cx";
import { Illustration, type IllustrationName } from "./illustrations";

export interface EmptyStateProps {
  // A named line drawing (preferred) or any icon node.
  art?: IllustrationName;
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}

export function EmptyState({ art, icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={cx("empty", compact && "is-compact")}>
      {art ? (
        <div className="empty-art">
          <Illustration name={art} size={compact ? 56 : 72} />
        </div>
      ) : icon ? (
        <div className="empty-icon">{icon}</div>
      ) : null}
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc">{description}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
