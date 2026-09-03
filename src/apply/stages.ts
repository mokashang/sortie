// Pure constants for the post-submit lifecycle — shared by src/apply/history.ts (server, sqlite)
// and the /history client component. Kept free of any db import so it can be bundled client-side.
export const POST_SUBMIT_STAGES = ["submitted", "oa", "interview", "offer", "rejected", "stale"] as const;
export type PostSubmitStage = (typeof POST_SUBMIT_STAGES)[number];

export const STAGE_LABELS: Record<PostSubmitStage, string> = {
  submitted: "已提交",
  oa: "OA",
  interview: "面试",
  offer: "Offer",
  rejected: "被拒",
  stale: "无回音",
};

export function isPostSubmitStage(s: string): s is PostSubmitStage {
  return (POST_SUBMIT_STAGES as readonly string[]).includes(s);
}

export interface HistoryRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: PostSubmitStage;
  submittedAt: string; // local "YYYY-MM-DD HH:MM"
  submittedDay: string; // local "YYYY-MM-DD" — the /history day-group key
  updatedAt: string; // local "YYYY-MM-DD HH:MM"
  resumeVersion: string | null;
  lastNote: string | null;
  // 内推 (a referral was recorded for this application) vs 海投 — the /history 方式 column.
  applyMode: "referral" | "direct";
  referralPersonName: string | null;
}
