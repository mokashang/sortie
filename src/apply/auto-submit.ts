import type { DB } from "@/lib/db";
import { decide } from "@/apply/queue";

// 自动投递 (2026-09-17): a per-account switch on 设置 that lets a filled application skip the
// user's confirmation. The user asked for it so a plan keeps moving while they are busy or
// away; before this every awaiting_confirm row sat until someone pressed 确认提交.
//
// What it does NOT change: reportSubmitted's red line still requires confirm_decision =
// 'approved' on an awaiting_confirm row. The switch only makes the App itself grant that
// approval the moment the assistant reports awaiting_confirm — the assistant never gets to skip
// the report, and every re-report still voids the earlier approval (a re-fill is re-approved
// only because the switch is still on at that moment). Outreach messages (referral / coffee
// chat) are not covered: a message to a person always waits for the user.
//
// Stored in the key/value `profile` table like ai_provider, one key per account, so no schema
// bump is needed and the setting survives a profile re-import.

export const AUTO_SUBMIT_KEY_PREFIX = "auto_submit:";

export function autoSubmitKey(userId: string): string {
  return `${AUTO_SUBMIT_KEY_PREFIX}${userId}`;
}

export function getAutoSubmit(db: DB, userId: string): boolean {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(autoSubmitKey(userId)) as { value: string } | undefined;
  if (!row) return false;
  try {
    return JSON.parse(row.value) === true;
  } catch {
    return row.value === "true";
  }
}

export function setAutoSubmit(db: DB, userId: string, enabled: boolean): void {
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    autoSubmitKey(userId),
    JSON.stringify(enabled === true)
  );
}

// Called right after a successful awaiting_confirm report. When the switch is on, grants the
// approval the user would otherwise give on the 待确认 card and returns true so the report
// response can tell the assistant to submit right away. Never throws: a failure here leaves the
// row waiting for a manual decision, which is the safe direction.
export function autoApproveIfEnabled(db: DB, userId: string, jobId: number): boolean {
  if (!getAutoSubmit(db, userId)) return false;
  try {
    decide(db, userId, jobId, "approve");
    return true;
  } catch {
    return false;
  }
}
