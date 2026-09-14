import type { Metadata } from "next";
import { authPublicConfig } from "@/lib/auth";
import { getMessages } from "@/i18n/server";
import { VerifyClient } from "./verify-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.verify.title };
}

// Shown right after sign-up when verification is required, and as the landing spot for a
// verification link that failed (?error=).
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const sp = await searchParams;
  return <VerifyClient email={sp.email ?? null} error={sp.error ?? null} mailerConfigured={authPublicConfig().mailerConfigured} />;
}
