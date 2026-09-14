import type { Metadata } from "next";
import { PageHeader } from "@/app/components/ui";
import { getMessages } from "@/i18n/server";
import { NetworkAssistant } from "./network-assistant";
import { NetworkClient } from "./network-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.network };
}

// 人脉: contacts plus coffee-chat / exploratory outreach. Job-linked referral requests live on
// 投递's 内推进行中 board, not here.
export default async function NetworkPage() {
  const m = await getMessages();
  return (
    <>
      <PageHeader title={m.nav.network} subtitle={m.network.subtitle} />
      <NetworkAssistant />
      <NetworkClient />
    </>
  );
}
