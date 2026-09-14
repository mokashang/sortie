import { requireUser } from "@/lib/session";
import { AppShell } from "@/app/components/shell/app-shell";
import { OverviewProvider } from "@/app/components/overview-context";

export const dynamic = "force-dynamic";

// Every signed-in page lives under this layout: one session check per request (the middleware
// already bounced cookie-less visitors to /login; this is the authoritative lookup), then the
// shell with the account in the sidebar. The overview poll only runs for signed-in pages.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <OverviewProvider>
      <AppShell user={{ name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified }}>{children}</AppShell>
    </OverviewProvider>
  );
}
