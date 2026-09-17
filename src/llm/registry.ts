import { LlmBackend } from "@/llm/types";
import { SubscriptionBackend } from "@/llm/backends/subscription";
import { CodexBackend } from "@/llm/backends/codex";
import { OpenAiBackend } from "@/llm/backends/openai";
import { getAiProvider, providerBackendName } from "@/ai/config";
import { getDb } from "@/lib/db";

// 用户可在设置里选择接入方式(spec §8.1)。目前实现订阅后端;API-key / 其他模型后端
// 在后续 plan 里追加为新的 register 项,匹配引擎与它们零耦合(只依赖 LlmBackend 契约)。
const registry = new Map<string, LlmBackend>();

export function registerBackend(be: LlmBackend): void {
  registry.set(be.name, be);
}

function ensureDefaults(): void {
  if (!registry.has("subscription")) registry.set("subscription", new SubscriptionBackend());
  if (!registry.has("codex")) registry.set("codex", new CodexBackend());
  if (!registry.has("openai")) registry.set("openai", new OpenAiBackend());
}

export function getBackend(name?: string): LlmBackend {
  ensureDefaults();
  let configured: string | undefined;
  if (!name) {
    try {
      configured = providerBackendName(getAiProvider(getDb()));
    } catch {
      configured = providerBackendName(getAiProvider());
    }
  }
  const key = name ?? configured ?? "subscription";
  const be = registry.get(key);
  if (!be) throw new Error(`unknown llm backend: ${key}`);
  return be;
}
