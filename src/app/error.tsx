"use client";
import { Button, EmptyState } from "@/app/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      art="warn"
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
