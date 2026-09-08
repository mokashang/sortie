import { getDb } from "@/lib/db";
import { overview } from "@/apply/overview";
import { TodayClient } from "./today/today-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "今日" };

// 今日: the decision inbox. Server-renders the first overview so the numbers are there on first
// paint; the client keeps them live through the shared OverviewProvider.
export default function HomePage() {
  return <TodayClient initial={overview(getDb())} />;
}
