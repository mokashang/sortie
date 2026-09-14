import { PageHeader } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { SourcesBoard } from "./sources-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "信息源" };

// 信息源 (advanced, reached from 设置 — not in the navigation): every polled board, its tier and
// errors. Day-to-day use never needs this page; the queue is the product.
export default function SourcesPage() {
  return (
    <>
      <PageHeader title="信息源" subtitle="后台每分钟检查一次哪些板块到期:核心每小时、长尾每天、休眠每周。这里用于排查,平时不用看。" actions={<ScanMenu />} />
      <SourcesBoard />
    </>
  );
}
