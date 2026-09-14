"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, RefreshCw, ScanSearch } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { labelOf } from "@/app/lib/labels";
import { Menu, useToast } from "@/app/components/ui";
import type { ButtonVariant } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { useOverview } from "./overview-context";
import { isLive } from "./assistant-card";

interface ScanSummary {
  inserted: number;
  upgraded: number;
  duplicates: number;
  sourceErrors: unknown[];
}

// 「扫描 ▾」: 立即扫描 (server-side core sources + lists) / 在我的 Chrome 里扫描 (queues a scan
// task for the assistant). Replaces the old 立即扫描 + Chrome 扫描 button pair.
export function ScanMenu({ onDone, variant = "secondary" }: { onDone?: () => void; variant?: ButtonVariant }) {
  const m = useMessages();
  const { toast } = useToast();
  const { data, refresh } = useOverview();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const scanRun = data?.assistant && data.assistant.kind === "scan" && isLive(data.assistant.status) ? data.assistant : null;

  async function scanNow() {
    setBusy(true);
    toast({ title: m.scan.startedTitle, description: m.scan.startedDescription, tone: "info", duration: 6000 });
    try {
      const s = await postJson<ScanSummary>("/api/scan");
      toast({
        title: m.scan.doneTitle(s.inserted),
        description: m.scan.doneDescription(s.upgraded, s.duplicates, s.sourceErrors?.length ?? 0),
        tone: "good",
      });
      router.refresh();
      onDone?.();
    } catch (e) {
      toast({ title: m.scan.failedTitle, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function chromeScan() {
    try {
      await postJson("/api/executor/start", { kind: "scan", channel: "user_chrome", options: {} });
      toast({ title: m.scan.chromeQueuedTitle, description: m.scan.chromeQueuedDescription, tone: "good" });
      await refresh();
    } catch (e) {
      toast({ title: m.scan.chromeQueueFailed, description: errorMessage(e), tone: "danger" });
    }
  }

  return (
    <Menu
      text={m.scan.menu}
      icon={<ScanSearch size={15} />}
      variant={variant}
      size="md"
      items={[
        { label: busy ? m.scan.scanning : m.scan.scanNow, icon: <RefreshCw size={14} />, onSelect: scanNow, disabled: busy },
        {
          label: scanRun ? m.scan.chromeStatus(labelOf(m.labels.runStatus, scanRun.status, scanRun.status)) : m.scan.chromeScan,
          icon: <Globe size={14} />,
          onSelect: chromeScan,
          disabled: !!scanRun,
        },
      ]}
    />
  );
}
