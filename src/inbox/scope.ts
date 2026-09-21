// The one Gmail scope 邮箱同步 asks for (spec 2026-09-21 inbox-sync §2). In its own module so the
// 设置 client component can import it without pulling the server-side Gmail client along.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
