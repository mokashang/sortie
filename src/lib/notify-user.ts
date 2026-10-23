import type { DB } from "@/lib/db";
import { ownerId } from "@/lib/users";

// Whose phone a push goes to (2026-10-22): notify(…, { account }) asks ntfyTopicFor. NTFY_TOPIC in
// .env is the box owner's channel; every other account pushes to a channel of its own, set on
// 设置 → 通知, or nowhere until it sets one (before, everything went to the owner's phone).

const KEY = (userId: string) => `ntfy_topic:${userId}`;

// ntfy topic names: letters, digits, _ and -, up to 64 (ntfy's own rule).
export const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function storedNtfyTopic(db: DB, userId: string): string | null {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(KEY(userId)) as { value: string } | undefined;
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v === "string" && NTFY_TOPIC_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function setNtfyTopic(db: DB, userId: string, topic: string | null): void {
  const t = topic?.trim() ?? "";
  if (!t) {
    db.prepare("DELETE FROM profile WHERE key = ?").run(KEY(userId));
    return;
  }
  if (!NTFY_TOPIC_RE.test(t)) throw new Error("ntfy channel names use letters, digits, _ and - only (up to 64)");
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY(userId), JSON.stringify(t));
}

// The account's own channel, else (owner only) the box's .env one; null = this account gets no push.
export function ntfyTopicFor(db: DB, userId: string, env: Record<string, string | undefined> = process.env): string | null {
  const own = storedNtfyTopic(db, userId);
  if (own) return own;
  const owner = ownerId(db);
  if (!owner || owner === userId) return env.NTFY_TOPIC?.trim() || null;
  return null;
}

