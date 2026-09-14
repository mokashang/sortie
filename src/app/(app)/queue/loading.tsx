import { Skeleton, SkeletonRows } from "@/app/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton width={90} height={28} />
      <div className="row mt-4 gap-4">
        <Skeleton width={120} height={44} />
        <Skeleton width={120} height={44} />
        <Skeleton width={120} height={44} />
      </div>
      <div className="mt-6">
        <SkeletonRows rows={10} />
      </div>
    </div>
  );
}
