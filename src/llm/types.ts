// 一次判断任务的契约:一段 prompt,期望模型回一段可解析为 JSON 的文本。
// backend 只负责"把 prompt 变成文本",解析与校验由调用方用 zod 完成。
export interface LlmRequest {
  system?: string;
  prompt: string;
  // 提示后端可用的模型档位(便宜/快 vs 强);后端自行映射到具体模型,允许忽略。
  tier?: "fast" | "smart";
  maxTokens?: number;
}

export interface LlmResult {
  text: string;          // 模型输出的主体文本(已从后端信封中提取)
  backend: string;       // 后端标识,用于日志/调试
  raw?: unknown;         // 后端原始响应,便于排错
}

export interface LlmBackend {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}
