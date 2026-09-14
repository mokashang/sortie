import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/paths";
import { DEFAULT_LANG, parseLang, type Lang } from "@/i18n/lang";

// Server-side preferences that background code needs without a browser request in hand — today
// just the UI language, so ntfy pushes and API errors come out in the language the user chose on
// 设置. Lives in <DATA_DIR>/prefs.json next to the database; the browser cookie (sortie.lang) is
// the per-request source of truth and this file is what a cookie-less request falls back to.
export interface Prefs {
  lang: Lang;
}

export function prefsPath(base: string = dataDir()): string {
  return path.join(base, "prefs.json");
}

export function readPrefs(base: string = dataDir()): Prefs {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(base), "utf8")) as { lang?: unknown };
    return { lang: parseLang(raw?.lang) ?? DEFAULT_LANG };
  } catch {
    return { lang: DEFAULT_LANG };
  }
}

export function writePrefs(patch: Partial<Prefs>, base: string = dataDir()): Prefs {
  const next: Prefs = { ...readPrefs(base), ...patch };
  const file = prefsPath(base);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function serverLang(base: string = dataDir()): Lang {
  return readPrefs(base).lang;
}
