import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getUser, type UserRow } from "@/lib/users";

// Server-component side of authentication. requireUser() is what every app page calls first:
// no session → /login (with the page to come back to). Wrapped in React's cache() so a page and
// its layout share one session lookup per request.

export const getSessionUser = cache(async (): Promise<UserRow | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return getUser(getDb(), session.user.id);
});

export async function requireUser(nextPath?: string): Promise<UserRow> {
  const user = await getSessionUser();
  if (!user) {
    const target = nextPath && nextPath.startsWith("/") ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
    redirect(target);
  }
  return user;
}
