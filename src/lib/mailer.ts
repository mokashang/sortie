import fs from "fs";
import path from "path";
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";

// Outbound email for the account flows (verification, password reset, email change, account
// deletion). SMTP when configured (`SMTP_URL`, e.g. smtps://user:pass@smtp.gmail.com:465, plus
// `MAIL_FROM`); otherwise the message is written to data/outbox/ and its action link logged, so a
// self-hosted single-person install can still complete every flow by opening the file. The
// templates come from the message tree (src/i18n/messages/mail.ts) in the language asked for.

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
function layout(title: string, lines: string[], action: { label: string; url: string }, lang: Lang): Mail["html"] {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171512;background:#f6f3ec;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fcfaf5;border:1px solid #e0dbcf;padding:28px 32px">
<div style="font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:22px;border-bottom:2px solid #171512;display:inline-block;padding-bottom:6px;margin-bottom:18px">Sortie</div>
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#8a1f11;color:#faf8f4;text-decoration:none;padding:10px 16px;font-weight:600">${esc(action.label)}</a></p>
<p style="font-size:12px;color:#6b665c">${esc(messages[lang].mail.linkFallback)}<br>${esc(action.url)}</p>
</div></body></html>`;
}

interface Template {
  subject: string;
  title: string;
  action: string;
  textLink: (url: string) => string;
}

function build(to: string, name: string, url: string, lang: Lang, t: Template, bodyLines: string[]): Mail {
  const lines = [messages[lang].mail.greeting(name), ...bodyLines];
  return {
    to,
    subject: t.subject,
    text: `${lines.join("\n")}\n\n${t.textLink(url)}\n`,
    html: layout(t.title, lines, { label: t.action, url }, lang),
  };
}

export function verificationMail(to: string, name: string, url: string, lang: Lang): Mail {
  const t = messages[lang].mail.verification;
  return build(to, name, url, lang, t, t.lines);
}

export function resetPasswordMail(to: string, name: string, url: string, lang: Lang): Mail {
  const t = messages[lang].mail.reset;
  return build(to, name, url, lang, t, t.lines);
}

export function changeEmailMail(to: string, name: string, newEmail: string, url: string, lang: Lang): Mail {
  const t = messages[lang].mail.changeEmail;
  return build(to, name, url, lang, t, t.lines(newEmail));
}

export function deleteAccountMail(to: string, name: string, url: string, lang: Lang): Mail {
  const t = messages[lang].mail.deleteAccount;
  return build(to, name, url, lang, t, t.lines);
}
