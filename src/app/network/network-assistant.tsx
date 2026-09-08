"use client";
import { useEffect, useState } from "react";
import { Send, UserSearch } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { getChannel, type Channel } from "@/app/lib/settings";
import { Button, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { AssistantCard } from "@/app/components/assistant-card";

// The 人脉 page's assistant card: status of network tasks plus the two start buttons
// (send approved messages / find people at the companies at the head of the queue).
export function NetworkAssistant() {
  const [channel, setChannel] = useState<Channel>("user_chrome");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, refresh } = useOverview();
  const { toast } = useToast();
  const live = data?.liveKinds ?? [];
  const pendingSend = data?.counts.networkPendingSend ?? 0;

  useEffect(() => setChannel(getChannel()), []);

  async function start(kind: "network_send" | "network_find", label: string) {
    setBusy(kind);
    try {
      await postJson("/api/executor/start", { kind, channel, options: {} });
      toast({ title: `已安排「${label}」`, description: channel === "user_chrome" ? "助手接手后在你的 Chrome 里开始。" : "后台浏览器已开始。", tone: "good" });
      await refresh();
    } catch (e) {
      toast({ title: "没能开始", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AssistantCard
      variant="compact"
      filterKinds={["network_send", "network_find"]}
      actions={
        <>
          <Button size="sm" icon={<Send size={13} />} loading={busy === "network_send"} disabled={live.includes("network_send") || pendingSend === 0} onClick={() => start("network_send", "发送已批准消息")}>
            发送已批准消息{pendingSend > 0 ? ` (${pendingSend})` : ""}
          </Button>
          <Button size="sm" variant="ghost" icon={<UserSearch size={13} />} loading={busy === "network_find"} disabled={live.includes("network_find")} onClick={() => start("network_find", "找人")}>
            找人(队列头部公司)
          </Button>
        </>
      }
    />
  );
}
