// Client-safe display helpers (no db imports). The label maps themselves live in the bilingual
// message tree (src/i18n/messages/labels.ts): a component takes `useMessages().labels` (client)
// or `(await getMessages()).labels` (server) and hands the right map to labelOf, so internal
// names (run statuses, ATS kinds, eligibility codes) never leak on screen. Tones stay here.
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { UNCLASSIFIED_DIRECTION } from "@/app/lib/queue-const";
import { directionLabel } from "@/matcher/directions";
export { directionLabel, DIRECTIONS } from "@/matcher/directions";

export type Tone = "neutral" | "accent" | "good" | "warn" | "danger" | "info";

export const RUN_STATUS_TONE: Record<string, Tone> = {
  queued: "info",
  running: "accent",
  done: "good",
  failed: "danger",
  stopped: "neutral",
};

export const OUTREACH_STATUS_TONE: Record<string, Tone> = {
  draft: "warn",
  pending_send: "info",
  sent: "good",
  accepted: "good",
  replied: "good",
  referral_won: "good",
  no_response: "neutral",
  archived: "neutral",
};

export const REFERRAL_STAGE_TONE: Record<string, Tone> = {
  pending: "neutral",
  accepted: "info",
  replied: "good",
  asked_resume: "warn",
  will_refer: "good",
  referred: "good",
  declined: "danger",
  no_headcount: "danger",
  other: "neutral",
};

export type LabelMaps = (typeof messages)["zh"]["labels"];

export function labelsFor(lang: Lang): LabelMaps {
  return messages[lang].labels;
}

export function labelOf(map: Record<string, string>, key: string | null | undefined, fallback = "—"): string {
  if (key == null) return fallback;
  return map[key] ?? fallback;
}

export function tierLabel(tier: number | null | undefined, lang: Lang): string {
  return messages[lang].labels.tier(tier);
}

// The effective apply mode as shown on a queue row: a resolved 'referral' is always 内推; a
// resolved 'direct' is 海投 only once Claude has actually classified the job (referral_fit set),
// otherwise it is just the default and reads as 未判定.
export function modeLabel(mode: "referral" | "direct" | null | undefined, fit: number | null | undefined, lang: Lang): string {
  const m = messages[lang].labels.mode;
  if (mode === "referral") return m.referral;
  if (mode === "direct") return fit == null ? m.undecided : m.direct;
  return m.undecided;
}

// A direction slug as shown on screen: the catalogue label, or 未分类 / Unclassified for a row
// that has no direction yet (NULL, or the queue's UNCLASSIFIED_DIRECTION tab sentinel).
export function directionName(slug: string | null | undefined, lang: Lang): string {
  if (!slug || slug === UNCLASSIFIED_DIRECTION) return messages[lang].labels.unclassified;
  return directionLabel(slug);
}
