"use client";
import { ToastProvider } from "@/app/components/ui/toast";
import { LangProvider } from "@/i18n/client";
import type { Lang } from "@/i18n/lang";
import { OverviewProvider } from "./overview-context";

// LangProvider sits outermost: the toast stack and everything below read their copy from it.
export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <LangProvider initial={lang}>
      <ToastProvider>
        <OverviewProvider>{children}</OverviewProvider>
      </ToastProvider>
    </LangProvider>
  );
}
