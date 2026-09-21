// 一次判断任务的契约:一段 prompt,期望模型回一段可解析为 JSON 的文本。
// backend 只负责"把 prompt 变成文本",解析与校验由调用方用 zod 完成。
export interface LlmRequest {
  system?: string;
  prompt: string;
  // 提示后端可用的模型档位(便宜/快 vs 强);后端自行映射到具体模型,允许忽略。
  tier?: "fast" | "smart";
  maxTokens?: number;
  // Bare mode (the in-app 问助手 chat, spec 2026-09-18 §5): `system` REPLACES the backend's default
  // system prompt instead of being appended to it, and the model gets no tools, no settings, no
  // repository memory and no MCP servers — it can only read what the prompt hands it. Backends
  // that are already isolated (codex exec, a direct API call) may ignore the flag.
  bare?: boolean;
  // With bare: the model may use the backend's own web search / page fetch tools and nothing
  // else — the chat's 「上网找」 step (spec 2026-09-18 §9). Backends without such tools ignore it;
  // callers check the backend name first.
  webTools?: boolean;
}

export interface LlmResult {
  text: string;          // 模型输出的主体文本(已从后端信封中提取)
  backend: string;       // 后端标识,用于日志/调试
  raw?: unknown;         // 后端原始响应,便于排错
}

export interface LlmBackend {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResult>;
  // Optional: the same completion delivered incrementally. `onDelta` receives each new piece of
  // output text as it arrives; the resolved result carries the whole text. Callers fall back to
  // complete() when a backend does not implement it.
  stream?(req: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult>;
}
