import type { Metadata } from "next";
import { authPublicConfig } from "@/lib/auth";
import { getMessages } from "@/i18n/server";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.signup.title };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const cfg = authPublicConfig();
  return <SignupForm next={sp.next ?? null} googleEnabled={cfg.googleEnabled} signupOpen={cfg.signupOpen} verificationRequired={cfg.emailVerificationRequired} />;
}
