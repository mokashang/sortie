import { defineMessages } from "../define";

// Push notifications (ntfy / desktop). Background code has no request, so the language comes
// from the saved server preference (src/lib/prefs.ts serverLang()). One entry per kind of 待处理
// card the assistant can raise (src/apply/info.ts needsInfoNotification).
export const notify = defineMessages({
  zh: {
    todo: {
      info: {
        title: (company: string, n: number) => `Sortie · ${company} 需要你补 ${n} 项信息`,
        body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 打开 App 投递页「待处理」填写,助手会接着投。`,
      },
      login: {
        title: (company: string, _n: number) => `Sortie · ${company} 需要你登录一次`,
        body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 打开 App 投递页「待处理」,登完点「我登好了」,助手接着投。`,
      },
      manual: {
        title: (company: string, _n: number) => `Sortie · ${company} 需要你亲自处理`,
        body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 打开 App 投递页「待处理」。`,
      },
      file: {
        title: (company: string, _n: number) => `Sortie · ${company} 需要你上传文件`,
        body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 打开 App 投递页「待处理」上传,助手会接着投。`,
      },
      action: {
        title: (company: string, _n: number) => `Sortie · ${company} 需要你在标签页里操作一下`,
        body: (jobTitle: string, labels: string) => `${jobTitle}:${labels} — 做完后打开 App 投递页「待处理」点「完成了」。`,
      },
    },
  },
  en: {
    todo: {
      info: {
        title: (company: string, n: number) => `Sortie · ${company} needs ${n === 1 ? "1 more answer" : `${n} more answers`}`,
        body: (jobTitle: string, labels: string) => `${jobTitle}: ${labels} — fill them in under To do on the Apply page and the assistant will carry on.`,
      },
      login: {
        title: (company: string, _n: number) => `Sortie · ${company} needs you to sign in once`,
        body: (jobTitle: string, labels: string) =>
          `${jobTitle}: ${labels} — open To do on the Apply page, sign in, then press I'm signed in and the assistant carries on.`,
      },
      manual: {
        title: (company: string, _n: number) => `Sortie · ${company} needs you to finish this yourself`,
        body: (jobTitle: string, labels: string) => `${jobTitle}: ${labels} — see To do on the Apply page.`,
      },
      file: {
        title: (company: string, _n: number) => `Sortie · ${company} needs a file from you`,
        body: (jobTitle: string, labels: string) => `${jobTitle}: ${labels} — upload it under To do on the Apply page and the assistant will carry on.`,
      },
      action: {
        title: (company: string, _n: number) => `Sortie · ${company} needs a quick action in its tab`,
        body: (jobTitle: string, labels: string) => `${jobTitle}: ${labels} — when it is done, press Done under To do on the Apply page.`,
      },
    },
  },
});
