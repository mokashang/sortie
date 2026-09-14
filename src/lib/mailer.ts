import fs from "fs";
import path from "path";

// Outbound email for the account flows (verification, password reset, email change, account
// deletion). SMTP when configured (`SMTP_URL`, e.g. smtps://user:pass@smtp.gmail.com:465, plus
// `MAIL_FROM`); otherwise the message is written to data/outbox/ and its action link logged, so a
// self-hosted single-person install can still complete every flow by opening the file.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  via: "smtp" | "outbox";
  file?: string;
}

export function mailerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SMTP_URL?.trim());
}

export function mailFrom(env: Record<string, string | undefined> = process.env): string {
  if (env.MAIL_FROM?.trim()) return env.MAIL_FROM.trim();
  const domain = env.SORTIE_DOMAIN?.trim() || "localhost";
  return `Sortie <no-reply@${domain}>`;
}

export function outboxDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "outbox");
}

export type Transport = (mail: Mail & { from: string }) => Promise<void>;
let transportOverride: Transport | null = null;
// Tests inject a fake transport; production builds one from SMTP_URL lazily.
export function setMailTransportForTests(t: Transport | null): void {
  transportOverride = t;
}

async function smtpTransport(): Promise<Transport> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport(process.env.SMTP_URL as string);
  return async (mail) => {
    await transporter.sendMail({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  };
}

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  const from = mailFrom();
  if (transportOverride) {
    await transportOverride({ ...mail, from });
    return { delivered: true, via: "smtp" };
  }
  if (mailerConfigured()) {
    const send = await smtpTransport();
    await send({ ...mail, from });
    return { delivered: true, via: "smtp" };
  }
  const dir = outboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = mail.to.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  const file = path.join(dir, `${stamp}-${slug}.txt`);
  fs.writeFileSync(file, `From: ${from}\nTo: ${mail.to}\nSubject: ${mail.subject}\nDate: ${new Date().toISOString()}\n\n${mail.text}\n`);
  const link = firstUrl(mail.text);
  console.log(`[mail] SMTP_URL not set — wrote "${mail.subject}" for ${mail.to} to ${file}${link ? `\n[mail] action link: ${link}` : ""}`);
  return { delivered: false, via: "outbox", file };
}

// The templates — plain text first (every mail client renders it), a minimal HTML twin.
function layout(title: string, lines: string[], action: { label: string; url: string }): Mail["html"] {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171512;background:#f6f3ec;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fcfaf5;border:1px solid #e0dbcf;padding:28px 32px">
<div style="font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:22px;border-bottom:2px solid #171512;display:inline-block;padding-bottom:6px;margin-bottom:18px">Sortie</div>
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#8a1f11;color:#faf8f4;text-decoration:none;padding:10px 16px;font-weight:600">${esc(action.label)}</a></p>
<p style="font-size:12px;color:#6b665c">如果按钮打不开,复制这个链接到浏览器:<br>${esc(action.url)}</p>
</div></body></html>`;
}

export function verificationMail(to: string, name: string, url: string): Mail {
  const lines = [`${name || "你好"},`, "点下面的按钮验证这个邮箱属于你。链接 1 小时内有效。", "如果不是你注册的 Sortie 账号,忽略这封邮件即可。"];
  return { to, subject: "验证你的 Sortie 邮箱", text: `${lines.join("\n")}\n\n验证邮箱:${url}\n`, html: layout("验证邮箱", lines, { label: "验证邮箱", url }) };
}

export function resetPasswordMail(to: string, name: string, url: string): Mail {
  const lines = [`${name || "你好"},`, "有人(希望是你)申请重置 Sortie 密码。点下面的按钮设置新密码,链接 1 小时内有效。", "没申请过?忽略这封邮件,密码不会变。"];
  return { to, subject: "重置你的 Sortie 密码", text: `${lines.join("\n")}\n\n重置密码:${url}\n`, html: layout("重置密码", lines, { label: "设置新密码", url }) };
}

export function changeEmailMail(to: string, name: string, newEmail: string, url: string): Mail {
  const lines = [`${name || "你好"},`, `你的 Sortie 账号申请把邮箱改为 ${newEmail}。点下面的按钮确认这次修改。`, "不是你操作的?忽略即可,邮箱不会变;建议顺手改一下密码。"];
  return { to, subject: "确认修改 Sortie 登录邮箱", text: `${lines.join("\n")}\n\n确认修改:${url}\n`, html: layout("确认修改邮箱", lines, { label: "确认修改", url }) };
}

export function deleteAccountMail(to: string, name: string, url: string): Mail {
  const lines = [`${name || "你好"},`, "你申请删除 Sortie 账号。点下面的按钮确认;这会删掉你的档案、经历、简历、投递记录和人脉,无法恢复。", "不是你操作的?忽略即可。"];
  return { to, subject: "确认删除 Sortie 账号", text: `${lines.join("\n")}\n\n确认删除:${url}\n`, html: layout("确认删除账号", lines, { label: "确认删除账号", url }) };
}
