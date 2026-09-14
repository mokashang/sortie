import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置新密码" };

// Better Auth's mail link lands on /api/auth/reset-password/<token>, which redirects here with
// ?token= (valid) or ?error=INVALID_TOKEN.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return <ResetForm token={sp.token ?? null} error={sp.error ?? null} />;
}
