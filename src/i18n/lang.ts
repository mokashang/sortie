// The two UI languages. Chinese is the original and stays the default; English is a full second
// version of every screen, notification and API error. Pure constants — safe in client bundles,
// route handlers and background jobs alike.
export const LANGS = ["zh", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "zh";

// The cookie the browser carries so server components render in the chosen language on first
// paint (no flash, no client-side re-render). Set by POST /api/settings/lang, one year, Lax.
export const LANG_COOKIE = "sortie.lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// The value of the <html lang> attribute per language.
export const HTML_LANG: Record<Lang, string> = { zh: "zh-CN", en: "en" };

// Each language's own name, shown in the switcher regardless of the current language.
export const LANG_NAME: Record<Lang, string> = { zh: "中文", en: "English" };

export function parseLang(v: unknown): Lang | null {
  return v === "zh" || v === "en" ? v : null;
}

export function otherLang(l: Lang): Lang {
  return l === "zh" ? "en" : "zh";
}

// Reads the language cookie out of a raw Cookie header ("a=1; sortie.lang=en; b=2").
export function langFromCookieHeader(header: string | null | undefined): Lang | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== LANG_COOKIE) continue;
    return parseLang(decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return null;
}
