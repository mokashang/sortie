"use client";
import { ToastProvider } from "@/app/components/ui/toast";
import { LangProvider } from "@/i18n/client";
import type { Lang } from "@/i18n/lang";

// App-wide client providers. LangProvider sits outermost so the toast stack and everything below
// read their copy from it. The overview poller is mounted by the signed-in (app) layout, not
// here, so the sign-in pages never poll an API they cannot reach.
export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <LangProvider initial={lang}>
      <ToastProvider>{children}</ToastProvider>
    </LangProvider>
  );
}
