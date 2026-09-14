import type { Metadata } from "next";
import { authPublicConfig } from "@/lib/auth";
import { getMessages } from "@/i18n/server";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.forgot.title };
}

export default function ForgotPasswordPage() {
  return <ForgotForm mailerConfigured={authPublicConfig().mailerConfigured} />;
}
