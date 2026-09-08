import { PageHeader } from "@/app/components/ui";
import { NetworkAssistant } from "./network-assistant";
import { NetworkClient } from "./network-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "人脉" };

// 人脉: contacts plus coffee-chat / exploratory outreach. Job-linked referral requests live on
// 投递's 内推进行中 board, not here.
export default function NetworkPage() {
  return (
    <>
      <PageHeader title="人脉" subtitle="联系人和探索性的请教消息。助手只发送你批准过的原文;找内推在投递页处理。" />
      <NetworkAssistant />
      <NetworkClient />
    </>
  );
}
