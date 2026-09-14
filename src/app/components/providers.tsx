"use client";
import { ToastProvider } from "@/app/components/ui/toast";

// App-wide client providers. The overview poller is mounted by the signed-in (app) layout, not
// here, so the sign-in pages never poll an API they cannot reach.
export function Providers({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
