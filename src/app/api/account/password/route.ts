import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { withUser } from "@/lib/actor";

// POST {newPassword} — give an account that signed up with Google (no credential row yet) a
// password, so it can also sign in by email. Better Auth's setPassword is server-only; it
// refuses when a password already exists (change-password is the client flow for that) and
// requires a fresh session.
export const POST = withUser(async (req, { via }) => {
  if (via !== "session") return NextResponse.json({ error: "请在浏览器里登录后操作" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const newPassword = String(body.newPassword ?? "");
  try {
    await getAuth().api.setPassword({ body: { newPassword }, headers: req.headers });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { status?: number; body?: { code?: string; message?: string } };
    const code = err.body?.code;
    const msg =
      code === "PASSWORD_TOO_SHORT" ? "密码至少 8 位。" : code === "PASSWORD_ALREADY_SET" ? "这个账号已经有密码了,用「修改密码」。" : err.body?.message ?? String(e);
    return NextResponse.json({ error: msg, code }, { status: typeof err.status === "number" ? err.status : 400 });
  }
});
