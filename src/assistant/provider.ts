import type { DB } from "@/lib/db";
import type { LlmBackend } from "@/llm/types";
import { getBackend } from "@/llm/registry";

// Which model answers the in-app 问助手 chat (spec 2026-09-18 §5). The user asked for the Claude
// subscription specifically, so that is the default whatever the global AI provider is; "follow"
// makes the chat use the same provider as matching, drafting and applying. Stored per account in
// the key/value `profile` table like auto_submit — no schema bump.
export type ChatProvider = "claude" | "follow";

export const CHAT_PROVIDER_KEY_PREFIX = "chat_provider:";

export function chatProviderKey(userId: string): string {
  return `${CHAT_PROVIDER_KEY_PREFIX}${userId}`;
}

export function parseChatProvider(value: unknown): ChatProvider | null {
  return value === "claude" || value === "follow" ? value : null;
}

export function getChatProvider(db: DB, userId: string): ChatProvider {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(chatProviderKey(userId)) as { value: string } | undefined;
  if (!row) return "claude";
  try {
    return parseChatProvider(JSON.parse(row.value)) ?? "claude";
  } catch {
    return parseChatProvider(row.value) ?? "claude";
  }
}

export function setChatProvider(db: DB, userId: string, provider: ChatProvider): void {
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    chatProviderKey(userId),
    JSON.stringify(provider)
  );
}

// The backend for one chat turn: the Claude CLI's saved login, or whatever 设置 → AI 提供方 says.
export function chatBackend(db: DB, userId: string): LlmBackend {
  return getChatProvider(db, userId) === "follow" ? getBackend() : getBackend("subscription");
}
