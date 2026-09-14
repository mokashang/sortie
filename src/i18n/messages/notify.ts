import { defineMessages } from "../define";

// Push notifications (ntfy / desktop). Background code has no request, so the language comes
// from the saved server preference (src/lib/prefs.ts serverLang()).
export const notify = defineMessages({
  zh: {
    needsInfo: {
      title: (company: string, n: number) => `Sortie · ${company} 需要你补 ${n} 项信息`,
      body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 打开 App 投递页「待补信息」填写,执行器会接着投。`,
    },
  },
  en: {
    needsInfo: {
      title: (company: string, n: number) => `Sortie · ${company} needs ${n === 1 ? "1 more answer" : `${n} more answers`}`,
      body: (jobTitle: string, labels: string) => `${jobTitle}: ${labels} — fill them in under Needs info on the Apply page and the assistant will carry on.`,
    },
  },
});
