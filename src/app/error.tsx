"use client";
import { Button, EmptyState } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const m = useMessages();
  return (
    <EmptyState
      art="warn"
      title={m.ui.errorTitle}
      description={error.message || m.ui.errorFallback}
      action={
        <Button variant="primary" onClick={reset}>
          {m.ui.retry}
        </Button>
      }
    />
  );
}
