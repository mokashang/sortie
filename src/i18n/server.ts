import { cookies } from "next/headers";
import { LANG_COOKIE, langFromCookieHeader, parseLang, type Lang } from "./lang";
import { messages, type Messages } from "./messages";
import { serverLang } from "@/lib/prefs";

// Server components and route handlers: the language is the sortie.lang cookie, falling back to
// the saved server preference (prefs.json) so a fresh browser opens in the language last chosen.
// cookies() throws outside a request scope (background jobs), which also falls back.
export async function getLang(): Promise<Lang> {
  try {
    const l = parseLang((await cookies()).get(LANG_COOKIE)?.value);
    if (l) return l;
  } catch {
    // not inside a request — use the saved preference
  }
  return serverLang();
}

export async function getMessages(): Promise<Messages> {
  return messages[await getLang()];
}

// Same rule for a route handler that already holds the Request (no async cookies() needed).
export function langFromRequest(req: Request): Lang {
  return langFromCookieHeader(req.headers.get("cookie")) ?? serverLang();
}

export function messagesFor(lang: Lang): Messages {
  return messages[lang];
}
