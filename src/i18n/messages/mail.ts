import { defineMessages } from "../define";

// The account emails (src/lib/mailer.ts): verification, password reset, email change, account
// deletion. Each has a subject, a heading, the body lines, the button label and the plain-text
// line that carries the link. The language is the one the request that triggered the mail was
// made in (the sortie.lang cookie), else the saved preference.
export const mail = defineMessages({
  zh: {
    greeting: (name: string) => `${name || "你好"},`,
    linkFallback: "如果按钮打不开,复制这个链接到浏览器:",
    verification: {
      subject: "验证你的 Sortie 邮箱",
      title: "验证邮箱",
      lines: ["点下面的按钮验证这个邮箱属于你。链接 1 小时内有效。", "如果不是你注册的 Sortie 账号,忽略这封邮件即可。"],
      action: "验证邮箱",
      textLink: (url: string) => `验证邮箱:${url}`,
    },
    reset: {
      subject: "重置你的 Sortie 密码",
      title: "重置密码",
      lines: ["有人(希望是你)申请重置 Sortie 密码。点下面的按钮设置新密码,链接 1 小时内有效。", "没申请过?忽略这封邮件,密码不会变。"],
      action: "设置新密码",
      textLink: (url: string) => `重置密码:${url}`,
    },
    changeEmail: {
      subject: "确认修改 Sortie 登录邮箱",
      title: "确认修改邮箱",
      lines: (newEmail: string) => [`你的 Sortie 账号申请把邮箱改为 ${newEmail}。点下面的按钮确认这次修改。`, "不是你操作的?忽略即可,邮箱不会变;建议顺手改一下密码。"],
      action: "确认修改",
      textLink: (url: string) => `确认修改:${url}`,
    },
    deleteAccount: {
      subject: "确认删除 Sortie 账号",
      title: "确认删除账号",
      lines: ["你申请删除 Sortie 账号。点下面的按钮确认;这会删掉你的档案、经历、简历、投递记录和人脉,无法恢复。", "不是你操作的?忽略即可。"],
      action: "确认删除账号",
      textLink: (url: string) => `确认删除:${url}`,
    },
  },
  en: {
    greeting: (name: string) => `Hi ${name || "there"},`,
    linkFallback: "If the button does not open, copy this link into your browser:",
    verification: {
      subject: "Verify your Sortie email",
      title: "Verify your email",
      lines: ["Press the button below to confirm this email address is yours. The link is valid for 1 hour.", "If you did not create a Sortie account, you can ignore this email."],
      action: "Verify email",
      textLink: (url: string) => `Verify your email: ${url}`,
    },
    reset: {
      subject: "Reset your Sortie password",
      title: "Reset your password",
      lines: [
        "Someone (hopefully you) asked to reset the Sortie password. Press the button below to set a new one; the link is valid for 1 hour.",
        "Did not ask for this? Ignore this email and your password stays the same.",
      ],
      action: "Set a new password",
      textLink: (url: string) => `Reset your password: ${url}`,
    },
    changeEmail: {
      subject: "Confirm your new Sortie sign-in email",
      title: "Confirm the email change",
      lines: (newEmail: string) => [
        `Your Sortie account asked to change its email to ${newEmail}. Press the button below to confirm the change.`,
        "Not you? Ignore this and the email stays the same; changing your password is a good idea too.",
      ],
      action: "Confirm the change",
      textLink: (url: string) => `Confirm the change: ${url}`,
    },
    deleteAccount: {
      subject: "Confirm deleting your Sortie account",
      title: "Confirm account deletion",
      lines: [
        "You asked to delete your Sortie account. Press the button below to confirm; this removes your profile, experience, resumes, application history and contacts, and cannot be undone.",
        "Not you? Just ignore this email.",
      ],
      action: "Delete my account",
      textLink: (url: string) => `Confirm deletion: ${url}`,
    },
  },
});
