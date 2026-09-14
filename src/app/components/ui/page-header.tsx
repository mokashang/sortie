export interface PageHeaderProps {
  title: React.ReactNode;
  // One short line above the title (a date, a section name). Never a paragraph.
  kicker?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, kicker, subtitle, actions, children }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        {kicker ? <div className="page-kicker">{kicker}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
      {children ? <div className="page-extra">{children}</div> : null}
    </header>
  );
}
