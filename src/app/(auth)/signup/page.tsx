import { authPublicConfig } from "@/lib/auth";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "创建账号" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const cfg = authPublicConfig();
  return <SignupForm next={sp.next ?? null} googleEnabled={cfg.googleEnabled} signupOpen={cfg.signupOpen} verificationRequired={cfg.emailVerificationRequired} />;
}
