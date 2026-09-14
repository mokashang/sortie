// Friendly labels for the profile's standard-answer keys. The keys themselves are what the
// apply executor looks up, so they stay stable; the UI shows the label and keeps the key as
// secondary text. The words live in src/i18n/messages/answers.ts.
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";

export type AnswerKey = keyof (typeof messages)["zh"]["answers"]["fields"];

export const ANSWER_KEYS = Object.keys(messages.zh.answers.fields) as AnswerKey[];

export function answerLabel(key: string, lang: Lang): string {
  const f = messages[lang].answers.fields as Record<string, { label: string; hint: string } | undefined>;
  return f[key]?.label ?? key;
}

export function answerHint(key: string, lang: Lang): string | undefined {
  const f = messages[lang].answers.fields as Record<string, { label: string; hint: string } | undefined>;
  const hint = f[key]?.hint;
  return hint ? hint : undefined;
}
