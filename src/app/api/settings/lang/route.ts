import { NextResponse } from "next/server";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, parseLang } from "@/i18n/lang";
import { readPrefs, writePrefs } from "@/lib/prefs";

// GET → {lang} — the saved server preference (what notifications use).
// POST {lang: 'zh'|'en'} — saves it and sets the sortie.lang cookie so the next server render
// already comes out in that language. The client also writes the cookie itself first (see
// src/i18n/client.tsx), so a failed call here only loses the server-side preference.
export async function GET() {
  return NextResponse.json({ lang: readPrefs().lang });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lang?: unknown };
  const lang = parseLang(body?.lang);
  if (!lang) return NextResponse.json({ error: "lang must be 'zh' or 'en'" }, { status: 400 });
  writePrefs({ lang });
  const res = NextResponse.json({ ok: true, lang });
  res.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: LANG_COOKIE_MAX_AGE, sameSite: "lax" });
  return res;
}
