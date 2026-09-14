// The Sortie mark: a ring with a gap where an arrow leaves it — a departure. Ink ring, signal
// arrow. Drawn inline so it takes the current text colour and the accent token of the theme.
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="45.55 11" strokeDashoffset="1.57" />
      <path d="M10.5 13.5 18.5 5.5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13 5.5h5.5V11" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
