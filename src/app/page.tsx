import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { overview } from "@/apply/overview";
import { getMessages } from "@/i18n/server";
import { TodayClient } from "./today/today-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.today };
}

// 今日: the decision inbox. Server-renders the first overview so the numbers are there on first
// paint; the client keeps them live through the shared OverviewProvider.
export default function HomePage() {
  return <TodayClient initial={overview(getDb())} />;
}
