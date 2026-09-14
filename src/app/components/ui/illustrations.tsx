// Small line drawings for empty states. One stroke weight, the current text colour, and a single
// signal-orange detail — so an empty screen still looks like part of the product, not a gap.

export type IllustrationName = "inbox" | "radar" | "ledger" | "people" | "paper" | "compass" | "warn";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SIGNAL = { fill: "none", stroke: "var(--accent)", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Illustration({ name, size = 72, className }: { name: IllustrationName; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 72 72", className, "aria-hidden": true as const };
  switch (name) {
    case "inbox":
      return (
        <svg {...common}>
          <path {...STROKE} d="M12 34v18a4 4 0 0 0 4 4h40a4 4 0 0 0 4-4V34" />
          <path {...STROKE} d="M12 34l7-14h34l7 14H46a10 10 0 0 1-20 0z" />
          <path {...SIGNAL} d="M40 8 60 4l-8 18" />
          <path {...SIGNAL} d="M40 8l12 4" />
        </svg>
      );
    case "radar":
      return (
        <svg {...common}>
          <circle {...STROKE} cx="36" cy="36" r="26" />
          <circle {...STROKE} cx="36" cy="36" r="15" strokeDasharray="3 4" />
          <path {...STROKE} d="M36 10v52M10 36h52" opacity="0.5" />
          <path {...SIGNAL} d="M36 36 56 20" />
          <circle fill="var(--accent)" cx="46" cy="27" r="2.6" />
        </svg>
      );
    case "ledger":
      return (
        <svg {...common}>
          <rect {...STROKE} x="14" y="10" width="44" height="52" rx="3" />
          <path {...STROKE} d="M22 24h28M22 33h28M22 42h18" />
          <circle {...SIGNAL} cx="48" cy="48" r="8" />
          <path {...SIGNAL} d="M44.5 48l2.5 2.5 5-5" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle {...STROKE} cx="27" cy="26" r="9" />
          <path {...STROKE} d="M10 56c1-11 8-17 17-17s16 6 17 17" />
          <circle {...SIGNAL} cx="49" cy="30" r="7" />
          <path {...SIGNAL} d="M43 56c1-8 5-13 11-13 4 0 7 2 9 5" />
        </svg>
      );
    case "paper":
      return (
        <svg {...common}>
          <path {...STROKE} d="M20 8h22l12 12v42a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
          <path {...STROKE} d="M42 8v12h12" />
          <path {...STROKE} d="M26 34h20M26 42h20M26 50h12" />
          <circle fill="var(--accent)" cx="50" cy="50" r="3" />
        </svg>
      );
    case "compass":
      return (
        <svg {...common}>
          <circle {...STROKE} cx="36" cy="36" r="26" />
          <path {...SIGNAL} d="M46 26 40 40l-14 6 6-14z" />
          <circle fill="currentColor" cx="36" cy="36" r="2" />
        </svg>
      );
    case "warn":
      return (
        <svg {...common}>
          <path {...STROKE} d="M36 12 62 58H10z" />
          <path {...SIGNAL} d="M36 28v14" />
          <circle fill="var(--accent)" cx="36" cy="49" r="2.2" />
        </svg>
      );
  }
}
