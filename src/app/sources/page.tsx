import type { Metadata } from "next";
import { PageHeader } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { getMessages } from "@/i18n/server";
import { SourcesBoard } from "./sources-board";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.sources };
}

// 信息源 (advanced, reached from 设置 — not in the navigation): every polled board, its tier and
// errors. Day-to-day use never needs this page; the queue is the product.
export default async function SourcesPage() {
  const m = await getMessages();
  return (
    <>
      <PageHeader title={m.nav.sources} subtitle={m.sources.subtitle} actions={<ScanMenu />} />
      <SourcesBoard />
    </>
  );
}
