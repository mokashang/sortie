"use client";
import { ToastProvider } from "@/app/components/ui/toast";
import { OverviewProvider } from "./overview-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <OverviewProvider>{children}</OverviewProvider>
    </ToastProvider>
  );
}
