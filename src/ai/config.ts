import type { DB } from "@/lib/db";

export type AiProvider = "claude" | "codex" | "gpt";
export type EnvMap = Record<string, string | undefined>;

export const AI_PROVIDER_KEY = "ai_provider";

export interface AiProviderStatus {
  provider: AiProvider;
  configured: boolean;
  reason: string | null;
}

export function parseAiProvider(value: unknown): AiProvider | null {
  return value === "claude" || value === "codex" || value === "gpt" ? value : null;
}

function providerFromDb(db: DB): AiProvider | null {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(AI_PROVIDER_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return parseAiProvider(JSON.parse(row.value));
  } catch {
    return parseAiProvider(row.value);
  }
}

// Existing installations keep Claude until the owner explicitly switches. This makes the
// migration non-breaking while allowing a fresh box to opt into Codex or GPT with AI_PROVIDER.
export function getAiProvider(db?: DB, env: EnvMap = process.env): AiProvider {
  const saved = db ? providerFromDb(db) : null;
  return saved ?? parseAiProvider(env.AI_PROVIDER) ?? "claude";
}

export function setAiProvider(db: DB, provider: AiProvider): void {
  db.prepare(
    "INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(AI_PROVIDER_KEY, JSON.stringify(provider));
}

export function providerBackendName(provider: AiProvider): "subscription" | "codex" | "openai" {
  if (provider === "codex") return "codex";
  if (provider === "gpt") return "openai";
  return "subscription";
}

export function providerStatuses(env: EnvMap = process.env): AiProviderStatus[] {
  const hasOpenAiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasOpenAiModel = Boolean(env.OPENAI_MODEL?.trim()) || Boolean(env.OPENAI_FAST_MODEL?.trim() && env.OPENAI_SMART_MODEL?.trim());
  return [
    { provider: "codex", configured: true, reason: null },
    {
      provider: "gpt",
      configured: hasOpenAiKey && hasOpenAiModel,
      reason: !hasOpenAiKey
        ? "OPENAI_API_KEY is missing"
        : !hasOpenAiModel
          ? "Set OPENAI_MODEL, or set both OPENAI_FAST_MODEL and OPENAI_SMART_MODEL"
          : null,
    },
    { provider: "claude", configured: true, reason: null },
  ];
}

export function assertProviderConfigured(provider: AiProvider, env: EnvMap = process.env): void {
  const status = providerStatuses(env).find((item) => item.provider === provider);
  if (!status?.configured) throw new Error(`${provider} AI provider is not configured: ${status?.reason ?? "unknown reason"}`);
}
