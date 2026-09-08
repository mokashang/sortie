"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, RefreshCw, ScanSearch } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { RUN_STATUS_LABEL, labelOf } from "@/app/lib/labels";
import { Menu, useToast } from "@/app/components/ui";
import type { ButtonVariant } from "@/app/components/ui";
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
  const { toast } = useToast();
  const { data, refresh } = useOverview();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const scanRun = data?.assistant && data.assistant.kind === "scan" && isLive(data.assistant.status) ? data.assistant : null;

  async function scanNow() {
    setBusy(true);
    toast({ title: "正在扫描核心信息源…", description: "通常需要一到三分钟,完成后会提示。", tone: "info", duration: 6000 });
    try {
      const s = await postJson<ScanSummary>("/api/scan");
      toast({
        title: `扫描完成:新增 ${s.inserted} 个职位`,
        description: `${s.upgraded} 个升级 · ${s.duplicates} 个重复 · ${s.sourceErrors?.length ?? 0} 个来源出错`,
        tone: "good",
      });
      router.refresh();
      onDone?.();
    } catch (e) {
      toast({ title: "扫描失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function chromeScan() {
    try {
      await postJson("/api/executor/start", { kind: "scan", channel: "user_chrome", options: {} });
      toast({ title: "已排队 Chrome 扫描", description: "助手接手后会在你的 Chrome 里只读地搜 LinkedIn、Handshake 和 Tesla。", tone: "good" });
      await refresh();
    } catch (e) {
      toast({ title: "没排上", description: errorMessage(e), tone: "danger" });
    }
  }

  return (
    <Menu
      text="扫描"
      icon={<ScanSearch size={15} />}
      variant={variant}
      size="md"
      items={[
        { label: busy ? "扫描中…" : "立即扫描(核心信息源)", icon: <RefreshCw size={14} />, onSelect: scanNow, disabled: busy },
        {
          label: scanRun ? `Chrome 扫描:${labelOf(RUN_STATUS_LABEL, scanRun.status, scanRun.status)}` : "在我的 Chrome 里扫描",
          icon: <Globe size={14} />,
          onSelect: chromeScan,
          disabled: !!scanRun,
        },
      ]}
    />
  );
}
