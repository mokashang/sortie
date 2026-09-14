import type { Metadata } from "next";
import { getMessages } from "@/i18n/server";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.reset.title };
}

// Better Auth's mail link lands on /api/auth/reset-password/<token>, which redirects here with
// ?token= (valid) or ?error=INVALID_TOKEN.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return <ResetForm token={sp.token ?? null} error={sp.error ?? null} />;
}
