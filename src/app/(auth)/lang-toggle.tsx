"use client";
import { Languages } from "lucide-react";
import { useLangToggle } from "@/app/components/shell/use-lang-toggle";
import { LANG_NAME, otherLang } from "@/i18n/lang";

// The sign-in pages have no top bar, so the language switch sits under the card: it names the
// language you would switch TO ("English" on the Chinese page), which is what a stranger to the
// current language can read.
export function AuthLangToggle() {
  const { lang, aria, toggle } = useLangToggle();
  const target = otherLang(lang);
  return (
    <button type="button" className="btn btn-ghost btn-sm auth-lang" onClick={toggle} aria-label={aria} lang={target === "zh" ? "zh-CN" : "en"}>
      <Languages size={14} aria-hidden />
      <span>{LANG_NAME[target]}</span>
    </button>
  );
}
