import { Skeleton, SkeletonRows } from "@/app/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton width="28%" height={28} />
      <div className="mt-4">
        <SkeletonRows rows={8} />
      </div>
    </div>
  );
}
