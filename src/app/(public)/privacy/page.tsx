import type { Metadata } from "next";
import { getMessages } from "@/i18n/server";
import { LegalDocView } from "../legal-doc";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).legal.privacy.title };
}

export default async function PrivacyPage() {
  return <LegalDocView m={await getMessages()} which="privacy" />;
}
