import { authPublicConfig } from "@/lib/auth";
import { VerifyClient } from "./verify-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "验证邮箱" };

// Shown right after sign-up when verification is required, and as the landing spot for a
// verification link that failed (?error=).
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const sp = await searchParams;
  return <VerifyClient email={sp.email ?? null} error={sp.error ?? null} mailerConfigured={authPublicConfig().mailerConfigured} />;
}
