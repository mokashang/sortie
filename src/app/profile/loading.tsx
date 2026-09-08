import { Skeleton, SkeletonCard } from "@/app/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton width={60} height={28} />
      <div className="mt-4">
        <SkeletonCard />
      </div>
      <div className="mt-4">
        <SkeletonCard />
      </div>
    </div>
  );
}
