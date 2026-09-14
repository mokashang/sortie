import { NextResponse } from "next/server";
import { authPublicConfig } from "@/lib/auth";
import { withUser } from "@/lib/actor";

// GET — read-only facts the 设置 page shows (nothing secret: whether phone push and mail are
// configured, whether Google sign-in is available, who is signed in).
export const GET = withUser(async (_req, { user, via }) => {
  return NextResponse.json({
    ntfyConfigured: Boolean(process.env.NTFY_TOPIC),
    ...authPublicConfig(),
    user: user ? { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role } : null,
    via,
  });
});
