import { DB } from "@/lib/db";
import { QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { applyEligibility, archiveCluster, Sponsorship, DegreeReq, RoleKind } from "@/apply/eligibility";
import { visaFlag } from "@/scanner/visa-filter";

export interface JdReviewTask { jobId: number; company: string; title: string; applyUrl: string; }

// A job is pending when ANY account has it queued (matched, not parked) and its JD is still
// missing — the JD is a shared fact, so one read serves everyone (spec 2026-09-13 accounts §3).
const PENDING_WHERE =
  `j.jd_status = 'missing' AND j.apply_url IS NOT NULL AND ${QUEUE_ELIGIBLE_SQL}
   AND EXISTS (SELECT 1 FROM applications a JOIN matches m ON m.job_id = a.job_id AND m.user_id = a.user_id
               WHERE a.job_id = j.id AND a.status = 'matched' AND a.needs_manual_reason IS NULL)`;
// 同队列顺序:置顶 > 梯队 > 分数 > 新(跨账号取最强的那一行)。不设 claim 状态 —— 同 kind 只允许一个活 run,没回报的行下次自然再发。
const PENDING_ORDER = `ORDER BY (SELECT MAX(a.pinned) FROM applications a WHERE a.job_id = j.id) DESC,
   (SELECT MIN(COALESCE(m.tier, 9)) FROM matches m WHERE m.job_id = j.id) ASC,
   (SELECT MAX(m.score) FROM matches m WHERE m.job_id = j.id) DESC, j.created_at DESC`;

export function nextJdReviewBatch(db: DB, limit: number): JdReviewTask[] {
  const rows = db.prepare(
    `SELECT j.id as jobId, j.company, j.title, j.apply_url as applyUrl
     FROM jobs j
     WHERE ${PENDING_WHERE}
     ${PENDING_ORDER}
     LIMIT ?`
  ).all(Math.max(1, Math.min(200, limit))) as JdReviewTask[];
  return rows;
}

export function pendingJdReviewCount(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) n FROM jobs j WHERE ${PENDING_WHERE}`).get() as { n: number }).n;
}

export type JdReviewStatus = "reviewed" | "login_wall" | "unreachable" | "closed";
export interface JdReviewReport {
  jobId: number; status: JdReviewStatus; jdText?: string;
  sponsorship?: Sponsorship; degree?: DegreeReq; role?: RoleKind; evidence?: string;
}
export interface JdReviewOutcome { jdStatus: string; archived: boolean; skipReason: string | null; requeued: boolean; }

const STATUSES: JdReviewStatus[] = ["reviewed", "login_wall", "unreachable", "closed"];
const MAX_JD = 20_000;

// The jd_review executor posts as application/x-www-form-urlencoded via `curl --data-urlencode`
// rather than JSON: hand-escaping a ~20k-char JD string into a JSON body from a shell script is
// fragile (quotes, newlines, control chars), while --data-urlencode handles that for free. This
// maps that form body into the same JdReviewReport shape reportJdReview expects. Types are kept
// loose at the boundary (status isn't validated here) — reportJdReview itself rejects an unknown
// status.
export function reportFromFormData(form: FormData): JdReviewReport {
  const get = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  // Only set keys that are actually present (and non-empty) in the form — an absent/empty field
  // must be an *absent* key on the result, not a key holding `undefined`, so reportJdReview's own
  // `?? "unknown"`-style defaulting and its `jdText` presence check behave the same as they do
  // for a JSON body that simply omits the field.
  const out: JdReviewReport = { jobId: Number(get("jobId")), status: get("status") as JdReviewStatus };
  const jdText = get("jdText");
  if (jdText !== undefined) out.jdText = jdText;
  const sponsorship = get("sponsorship");
  if (sponsorship !== undefined) out.sponsorship = sponsorship as Sponsorship;
  const degree = get("degree");
  if (degree !== undefined) out.degree = degree as DegreeReq;
  const role = get("role");
  if (role !== undefined) out.role = role as RoleKind;
  const evidence = get("evidence");
  if (evidence !== undefined) out.evidence = evidence;
  return out;
}

export function reportJdReview(db: DB, input: JdReviewReport): JdReviewOutcome {
  if (!STATUSES.includes(input.status)) throw new Error(`reportJdReview: invalid status '${input.status}'`);
  const job = db.prepare("SELECT id FROM jobs WHERE id = ?").get(input.jobId);
  if (!job) throw new Error(`reportJdReview: no job ${input.jobId}`);

  if (input.status === "closed") {
    db.prepare("UPDATE jobs SET jd_status = 'closed' WHERE id = ?").run(input.jobId);
    archiveCluster(db, input.jobId, "posting closed", { respectPinned: false });
    return { jdStatus: "closed", archived: true, skipReason: "posting closed", requeued: false };
  }
  if (input.status === "login_wall" || input.status === "unreachable") {
    db.prepare("UPDATE jobs SET jd_status = ? WHERE id = ?").run(input.status, input.jobId);
    return { jdStatus: input.status, archived: false, skipReason: null, requeued: false };
  }

  // reviewed
  if (typeof input.jdText !== "string" || input.jdText.trim() === "") throw new Error("reportJdReview: reviewed requires jdText");
  const text = input.jdText.slice(0, MAX_JD);
  const flag = visaFlag(text);
  const tx = db.transaction((): JdReviewOutcome => {
    db.prepare("UPDATE jobs SET jd_text = ?, jd_status = 'reviewed', visa_flag = ? WHERE id = ?").run(text, flag, input.jobId);
    if (flag) {
      archiveCluster(db, input.jobId, "visa (jd review)");
      return { jdStatus: "reviewed", archived: true, skipReason: "visa (jd review)", requeued: false };
    }
    const elig = applyEligibility(db, {
      jobId: input.jobId, sponsorship: input.sponsorship ?? "unknown", degree: input.degree ?? "ms_ok",
      role: input.role ?? "eng", source: "jd_review", evidence: input.evidence,
    });
    if (elig.failReason) return { jdStatus: "reviewed", archived: true, skipReason: elig.failReason, requeued: false };
    // 资格通过:删旧 match 行、回 discovered,让下一轮增量匹配带完整 JD 重打。pinned 保留在 applications 上。
    db.prepare("DELETE FROM matches WHERE job_id = ?").run(input.jobId);
    db.prepare("UPDATE applications SET status = 'discovered' WHERE job_id = ? AND status = 'matched'").run(input.jobId);
    return { jdStatus: "reviewed", archived: false, skipReason: null, requeued: true };
  });
  return tx();
}
