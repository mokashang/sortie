// Pure constants for the post-submit lifecycle — shared by src/apply/history.ts (server, sqlite)
// and the /history client component. Kept free of any db import so it can be bundled client-side.
export const POST_SUBMIT_STAGES = [
  "submitted",
  "oa",
  "interview",
  "offer",
  "offer_accepted",
  "offer_declined",
  "rejected",
  "stale",
] as const;
export type PostSubmitStage = (typeof POST_SUBMIT_STAGES)[number];

export const STAGE_LABELS: Record<PostSubmitStage, string> = {
  submitted: "已提交",
  oa: "OA",
  interview: "面试",
  offer: "Offer",
  offer_accepted: "已接受",
  offer_declined: "已婉拒",
  rejected: "被拒",
  stale: "无回音",
};

export function isPostSubmitStage(s: string): s is PostSubmitStage {
  return (POST_SUBMIT_STAGES as readonly string[]).includes(s);
}

// The "ladder" an application climbs: every row reached at least 'submitted'; the peak is the
// furthest rung it ever touched. rejected/stale are outcomes, not rungs — a rejection after an
// interview still has peak 'interview'. offer_accepted/offer_declined are outcomes of the 'offer'
// rung. This is what lets the /history funnel chart draw "rejected after interview" as a branch
// off the interview node rather than lumping every rejection at the root.
export const PEAK_STAGES = ["submitted", "oa", "interview", "offer"] as const;
export type PeakStage = (typeof PEAK_STAGES)[number];

export function peakOf(status: PostSubmitStage): PeakStage {
  switch (status) {
    case "oa":
    case "interview":
    case "offer":
      return status;
    case "offer_accepted":
    case "offer_declined":
      return "offer";
    default:
      return "submitted";
  }
}

export function maxPeak(a: PeakStage, b: PeakStage): PeakStage {
  return PEAK_STAGES.indexOf(a) >= PEAK_STAGES.indexOf(b) ? a : b;
}

export interface HistoryRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: PostSubmitStage;
  peak: PeakStage; // furthest rung ever reached (from the stage-event timeline + current status)
  submittedAt: string; // local "YYYY-MM-DD HH:MM"
  submittedDay: string; // local "YYYY-MM-DD" — the /history day-group key
  updatedAt: string; // local "YYYY-MM-DD HH:MM"
  resumeVersion: string | null;
  lastNote: string | null;
}
