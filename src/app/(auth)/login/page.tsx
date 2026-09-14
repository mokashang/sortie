import type { Metadata } from "next";
import { authPublicConfig } from "@/lib/auth";
import { getMessages } from "@/i18n/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.login.title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const cfg = authPublicConfig();
  return <LoginForm next={sp.next ?? null} oauthError={sp.error ?? null} googleEnabled={cfg.googleEnabled} signupOpen={cfg.signupOpen} />;
}
