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
    // 自动投递 on: the assistant submitted without a confirmation — a heads-up, not a to-do.
    autoSubmitted: {
      title: (company: string) => `Sortie · 已自动投出 ${company}`,
      body: (jobTitle: string) => `${jobTitle} — 自动投递已开启,助手填好后直接提交了;记录在「历史」里。`,
    },
    // 内推对话跟进 (spec 2026-09-30): someone replied / accepted, and what the assistant does about it.
    referral: {
      replied: (person: string, company: string) => `Sortie · ${person}(${company})回复了你`,
      accepted: (person: string, company: string) => `Sortie · ${person}(${company})接受了好友邀请`,
      nudge: (person: string, company: string) => `Sortie · 该跟进 ${person}(${company})了`,
      sending: "助手已起草好下一条消息并直接发出(自动投递已开启)。",
      approve: "助手起草好了下一条消息,打开投递页「内推进行中」看一眼、批准后助手发出。",
      question: (q: string) => `需要你来定:${q} — 打开投递页「内推进行中」回答,助手按你的回答起草回复。`,
      body: (summary: string | null, next: string) => [summary, next].filter(Boolean).join(" — "),
    },
    // 邮箱同步 (spec 2026-09-21): a mail moved an application's stage, or carries a next step.
    inbox: {
      changed: (company: string, stage: string) => `Sortie · ${company} → ${stage}`,
      news: (company: string, outcome: string) => `Sortie · ${company} 来信:${outcome}`,
      body: (jobTitle: string, summary: string, nextStep: string | null) =>
        [jobTitle, summary, nextStep ? `下一步:${nextStep}` : ""].filter(Boolean).join(" — ") + " (来自邮箱,已记进「历史」)",
      outcome: {
        received: "已收到申请",
        rejected: "被拒",
        oa: "OA 邀请",
        interview: "面试邀请",
        offer: "Offer",
        other: "有更新",
        unrelated: "无关",
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
    autoSubmitted: {
      title: (company: string) => `Sortie · auto-submitted to ${company}`,
      body: (jobTitle: string) => `${jobTitle} — auto-apply is on, so the assistant submitted as soon as the form was filled; it is in History.`,
    },
    referral: {
      replied: (person: string, company: string) => `Sortie · ${person} (${company}) replied`,
      accepted: (person: string, company: string) => `Sortie · ${person} (${company}) accepted your invite`,
      nudge: (person: string, company: string) => `Sortie · time to follow up with ${person} (${company})`,
      sending: "The assistant drafted the next message and is sending it now (auto-apply is on).",
      approve: "The assistant drafted the next message — approve it under Referrals in progress on the Apply page and it goes out.",
      question: (q: string) => `Your call: ${q} — answer it under Referrals in progress on the Apply page and the assistant drafts the reply from it.`,
      body: (summary: string | null, next: string) => [summary, next].filter(Boolean).join(" — "),
    },
    inbox: {
      changed: (company: string, stage: string) => `Sortie · ${company} → ${stage}`,
      news: (company: string, outcome: string) => `Sortie · mail from ${company}: ${outcome}`,
      body: (jobTitle: string, summary: string, nextStep: string | null) =>
        [jobTitle, summary, nextStep ? `Next step: ${nextStep}` : ""].filter(Boolean).join(" — ") + " (from your mailbox, recorded in History)",
      outcome: {
        received: "application received",
        rejected: "rejected",
        oa: "OA invite",
        interview: "interview invite",
        offer: "offer",
        other: "update",
        unrelated: "unrelated",
      },
    },
  },
});
