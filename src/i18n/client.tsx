"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LANG, HTML_LANG, LANG_COOKIE, LANG_COOKIE_MAX_AGE, type Lang } from "./lang";
import { messages, type Messages } from "./messages";

interface LangContextValue {
  lang: Lang;
  setLang: (next: Lang) => Promise<void>;
}

const LangContext = createContext<LangContextValue>({ lang: DEFAULT_LANG, setLang: async () => {} });

// Provided once from the root layout with the language the server rendered in, so the first
// client render agrees with the HTML. Switching writes the cookie (client side at once, then
// through the API which also saves the server preference), updates every client component
// through context, and refreshes the route so server components re-render in the new language.
export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const router = useRouter();

  useEffect(() => setLangState(initial), [initial]);

  const setLang = useCallback(
    async (next: Lang) => {
      setLangState(next);
      try {
        document.documentElement.lang = HTML_LANG[next];
        document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
      } catch {
        // no document (should not happen in a client component) — the API call below still sets the cookie
      }
      try {
        await fetch("/api/settings/lang", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lang: next }),
        });
      } catch {
        // offline: the client-side cookie already carries the choice for this browser
      }
      router.refresh();
    },
    [router]
  );

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext).lang;
}

export function useSetLang(): (next: Lang) => Promise<void> {
  return useContext(LangContext).setLang;
}

// The whole message tree for the current language: `const m = useMessages(); m.nav.today`.
export function useMessages(): Messages {
  return messages[useContext(LangContext).lang];
}
