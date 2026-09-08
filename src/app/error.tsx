"use client";
import { TriangleAlert } from "lucide-react";
import { Button, EmptyState } from "@/app/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert size={28} />}
      title="出了点问题"
      description={error.message || "页面渲染失败。"}
      action={
        <Button variant="primary" onClick={reset}>
          重试
        </Button>
      }
    />
  );
}
