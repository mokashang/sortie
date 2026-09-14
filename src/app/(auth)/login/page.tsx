import { authPublicConfig } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const cfg = authPublicConfig();
  return <LoginForm next={sp.next ?? null} oauthError={sp.error ?? null} googleEnabled={cfg.googleEnabled} signupOpen={cfg.signupOpen} />;
}
