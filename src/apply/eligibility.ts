import { DB, logEvent } from "@/lib/db";

export type Sponsorship = "yes" | "no" | "unknown";
export type DegreeReq = "ms_ok" | "phd_only";
export type RoleKind = "eng" | "non_tech";
export type EligSource = "match_llm" | "jd_review" | "executor_live";
export type FailReason = "no sponsorship" | "PhD only" | "non-engineering role";

export interface EligibilityInput {
  jobId: number;
  sponsorship: Sponsorship;
  degree: DegreeReq;
  role: RoleKind;
  source: EligSource;
  evidence?: string;
}
export interface EligibilityOutcome {
  written: boolean;
  failReason: FailReason | null;
  archivedJobIds: number[];
}

// 证据强度:活页面(执行器) > Claude 逐页读 > 匹配 LLM 看的截断 JD。低优先级不覆盖高优先级。
const SOURCE_RANK: Record<EligSource, number> = { match_llm: 1, jd_review: 2, executor_live: 3 };

export function eligibilityFailReason(e: { sponsorship: Sponsorship; degree: DegreeReq; role: RoleKind }): FailReason | null {
  if (e.sponsorship === "no") return "no sponsorship";
  if (e.degree === "phd_only") return "PhD only";
  if (e.role === "non_tech") return "non-engineering role";
  return null;
}

// 簇 = 主行 + 所有 duplicate_of 指向主行的行。从任一成员出发都能解析到整簇。
export function clusterIds(db: DB, jobId: number): number[] {
  const row = db.prepare("SELECT id, duplicate_of FROM jobs WHERE id = ?").get(jobId) as
    | { id: number; duplicate_of: number | null }
    | undefined;
  if (!row) return [];
  const canonical = row.duplicate_of ?? row.id;
  const rows = db.prepare("SELECT id FROM jobs WHERE id = ? OR duplicate_of = ?").all(canonical, canonical) as { id: number }[];
  return rows.map((r) => r.id);
}

// 归档整簇:open 状态(discovered/matched/prepared)的行改 archived;所有成员若有 match 行则写 skip_reason
// (已归档的只补 reason)。pinned 的行默认跳过 —— 用户手动置顶是比任何自动判断更强的信号。
export function archiveCluster(db: DB, jobId: number, skipReason: string, opts: { respectPinned?: boolean } = {}): number[] {
  const respectPinned = opts.respectPinned ?? true;
  const ids = clusterIds(db, jobId);
  const archived: number[] = [];
  // A sibling already tagged "duplicate of #<main>" carries the cluster's provenance — the
  // cascade reason (e.g. no-sponsor) must not clobber that label with the wrong story.
  const setSkip = db.prepare(
    "UPDATE matches SET skip_reason = ? WHERE job_id = ? AND (skip_reason IS NULL OR skip_reason NOT LIKE 'duplicate of #%')"
  );
  const archive = db.prepare(
    `UPDATE applications SET status = 'archived' WHERE job_id = ? AND status IN ('discovered','matched','prepared')` +
      (respectPinned ? " AND pinned = 0" : "")
  );
  const tx = db.transaction(() => {
    for (const id of ids) {
      setSkip.run(skipReason, id);
      if (archive.run(id).changes > 0) archived.push(id);
    }
  });
  tx();
  return archived;
}

export function applyEligibility(
  db: DB,
  input: EligibilityInput,
  opts: { archive?: boolean; respectPinned?: boolean } = {}
): EligibilityOutcome {
  const existing = db.prepare("SELECT elig_source FROM jobs WHERE id = ?").get(input.jobId) as
    | { elig_source: EligSource | null }
    | undefined;
  if (!existing) throw new Error(`applyEligibility: no job ${input.jobId}`);
  if (existing.elig_source && SOURCE_RANK[existing.elig_source] > SOURCE_RANK[input.source]) {
    return { written: false, failReason: null, archivedJobIds: [] };
  }
  db.prepare("UPDATE jobs SET sponsorship = ?, degree_req = ?, role_kind = ?, elig_source = ? WHERE id = ?").run(
    input.sponsorship, input.degree, input.role, input.source, input.jobId
  );
  const failReason = eligibilityFailReason(input);
  if (!failReason) return { written: true, failReason: null, archivedJobIds: [] };
  logEvent(db, "eligibility_fail", {
    entity: "job", entityId: input.jobId,
    payload: { reason: failReason, source: input.source, evidence: input.evidence ?? null },
  });
  const archivedJobIds = (opts.archive ?? true) ? archiveCluster(db, input.jobId, failReason, { respectPinned: opts.respectPinned }) : [];
  return { written: true, failReason, archivedJobIds };
}
