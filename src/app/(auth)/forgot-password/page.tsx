import { authPublicConfig } from "@/lib/auth";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "找回密码" };

export default function ForgotPasswordPage() {
  return <ForgotForm mailerConfigured={authPublicConfig().mailerConfigured} />;
}
