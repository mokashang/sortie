import { cx } from "@/app/lib/cx";

export function Skeleton({ width, height = 14, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx("skeleton", className)} style={{ width, height }} aria-hidden />;
}

const WIDTHS = ["72%", "58%", "84%", "46%", "66%", "77%", "52%", "88%"];

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={WIDTHS[i % WIDTHS.length]} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" aria-busy="true">
      <Skeleton width="40%" height={18} />
      <div className="mt-3">
        <SkeletonRows rows={3} />
      </div>
    </div>
  );
}
