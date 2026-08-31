import { LlmBackend } from "@/llm/types";
import { SubscriptionBackend } from "@/llm/backends/subscription";

// 用户可在设置里选择接入方式(spec §8.1)。目前实现订阅后端;API-key / 其他模型后端
// 在后续 plan 里追加为新的 register 项,匹配引擎与它们零耦合(只依赖 LlmBackend 契约)。
const registry = new Map<string, LlmBackend>();

export function registerBackend(be: LlmBackend): void {
  registry.set(be.name, be);
}

function ensureDefaults(): void {
  if (!registry.has("subscription")) registry.set("subscription", new SubscriptionBackend());
}

export function getBackend(name?: string): LlmBackend {
  ensureDefaults();
  const key = name ?? process.env.LLM_BACKEND ?? "subscription";
  const be = registry.get(key);
  if (!be) throw new Error(`unknown llm backend: ${key}`);
  return be;
}
