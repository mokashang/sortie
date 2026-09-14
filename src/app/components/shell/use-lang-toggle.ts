"use client";
import { useLang, useMessages, useSetLang } from "@/i18n/client";
import { LANG_NAME, otherLang } from "@/i18n/lang";

// One click flips 中文 ⇄ English (the full choice also lives on 设置). Used by the top bar, the
// phone 「更多」 sheet and the ⌘K palette; it lives in its own module so the palette and the shell
// do not have to import each other.
export function useLangToggle() {
  const m = useMessages();
  const lang = useLang();
  const setLang = useSetLang();
  const name = LANG_NAME[lang];
  return {
    lang,
    name,
    aria: m.shell.languageAria(name),
    title: m.shell.languageTitle(name),
    toggle: () => void setLang(otherLang(lang)),
  };
}
