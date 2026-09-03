import { DB, logEvent } from "@/lib/db";
import { LlmBackend } from "@/llm/types";
import { excerptJd } from "@/matcher/prompt";
import { buildConsolidatePrompt, parseConsolidateResults, rankLocation, GroupInput, GroupRow } from "@/scanner/consolidate-prompt";

export interface ConsolidateOptions { backend: LlmBackend; groupsPerCall?: number; limitGroups?: number; }
export interface ConsolidateSummary { groups: number; clusters: number; archived: number; errors: string[]; durationMs: number; }

interface RawRow {
  id: number; location: string | null; posted_at: string | null; source: string; ats: string | null; apply_url: string | null;
  jd_text: string | null; duplicate_of: number | null; status: string; dedup_judged_at: string | null;
}

// 待判组:同 dedup_key、美国岗 ≥ 2 行、至少一行没判过。
export function pendingGroupKeys(db: DB, limit?: number): string[] {
  return (
    db.prepare(
      `SELECT dedup_key FROM jobs WHERE loc_flag IS NULL AND dedup_key IS NOT NULL
       GROUP BY dedup_key HAVING COUNT(*) >= 2 AND SUM(dedup_judged_at IS NULL) > 0
       ORDER BY dedup_key ${limit ? "LIMIT " + Number(limit) : ""}`
    ).all() as { dedup_key: string }[]
  ).map((r) => r.dedup_key);
}

function loadGroup(db: DB, key: string): RawRow[] {
  return db.prepare(
    `SELECT j.id, j.location, j.posted_at, j.source, j.ats, j.apply_url, j.jd_text, j.duplicate_of, j.dedup_judged_at, a.status
     FROM jobs j JOIN applications a ON a.job_id = j.id
     WHERE j.dedup_key = ? AND j.loc_flag IS NULL ORDER BY j.id`
  ).all(key) as RawRow[];
}

const IN_FLIGHT = new Set(["prepared", "awaiting_confirm", "submitted", "oa", "interview", "offer"]);
const isRich = (jd: string | null) => !!jd && !jd.startsWith("[listing metadata]");

// 主行选择是代码规则,不交给 LLM(spec §4)。
export function pickCanonical(db: DB, ids: number[]): number {
  const rows = db.prepare(
    `SELECT j.id, j.location, j.jd_text, j.source, a.status FROM jobs j JOIN applications a ON a.job_id = j.id
     WHERE j.id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids) as { id: number; location: string | null; jd_text: string | null; source: string; status: string }[];
  const score = (r: (typeof rows)[number]) => [
    IN_FLIGHT.has(r.status) ? 0 : 1,
    rankLocation(r.location),
    isRich(r.jd_text) ? 0 : 1,
    r.source === "github_list" ? 1 : 0,
    r.id,
  ];
  rows.sort((a, b) => { const sa = score(a), sb = score(b); for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]; return 0; });
  return rows[0].id;
}

function toGroupInput(key: string, rows: RawRow[]): GroupInput {
  const toRow = (r: RawRow): GroupRow => {
    let tail = "";
    try { const u = new URL(r.apply_url ?? ""); tail = u.host + u.pathname.split("/").slice(-2).join("/"); } catch { tail = ""; }
    const jd = r.jd_text ?? "";
    return {
      id: r.id, location: r.location, posted_at: r.posted_at, source: r.source, ats: r.ats, url_tail: tail,
      jd_len: jd.length, jd_excerpt: isRich(jd) ? excerptJd(jd, 400).slice(0, 200) : "",
      cluster: r.duplicate_of ?? (rows.some((o) => o.duplicate_of === r.id) ? r.id : null),
    };
  };
  return { key, rows: rows.map(toRow) };
}

export async function runConsolidate(db: DB, opts: ConsolidateOptions): Promise<ConsolidateSummary> {
  const startedAt = Date.now();
  const per = opts.groupsPerCall ?? 15;
  const summary: ConsolidateSummary = { groups: 0, clusters: 0, archived: 0, errors: [], durationMs: 0 };
  const keys = pendingGroupKeys(db, opts.limitGroups);
  const setDup = db.prepare("UPDATE jobs SET duplicate_of = ? WHERE id = ? AND duplicate_of IS NULL");
  const archive = db.prepare("UPDATE applications SET status = 'archived' WHERE job_id = ? AND status IN ('discovered','matched')");
  const setSkip = db.prepare("UPDATE matches SET skip_reason = ? WHERE job_id = ?");
  const stamp = db.prepare("UPDATE jobs SET dedup_judged_at = datetime('now') WHERE id = ?");

  for (let i = 0; i < keys.length; i += per) {
    const batchKeys = keys.slice(i, i + per);
    const groups = batchKeys.map((k) => ({ key: k, rows: loadGroup(db, k) }));
    let results;
    try {
      const res = await opts.backend.complete(buildConsolidatePrompt(groups.map((g) => toGroupInput(g.key, g.rows))));
      results = parseConsolidateResults(res.text);
    } catch (e) {
      summary.errors.push(String(e));
      continue;
    }
    const byKey = new Map(results.map((r) => [r.key, r.clusters]));
    const tx = db.transaction(() => {
      for (const g of groups) {
        const clusters = byKey.get(g.key);
        if (!clusters) continue;
        const valid = new Set(g.rows.map((r) => r.id));
        const seen = new Set<number>();
        summary.groups++;
        for (const raw of clusters) {
          const ids = raw.filter((id) => valid.has(id) && !seen.has(id));
          ids.forEach((id) => seen.add(id));
          if (ids.length === 0) continue;
          summary.clusters++;
          // 已有 duplicate_of 的行保持原主行:模型无法拆散已判簇(spec §4 "只加不拆、不解归档")。
          const anchored = ids.map((id) => g.rows.find((r) => r.id === id)!.duplicate_of).find((d) => d != null) ?? null;
          const canonical = anchored ?? pickCanonical(db, ids);
          for (const id of ids) {
            stamp.run(id);
            if (id === canonical) continue;
            const row = g.rows.find((r) => r.id === id)!;
            if (row.duplicate_of != null) continue; // already linked elsewhere — leave it
            setDup.run(canonical, id);
            setSkip.run(`duplicate of #${canonical}`, id);
            if (archive.run(id).changes > 0) summary.archived++;
          }
        }
      }
    });
    tx();
  }
  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "consolidate_done", { entity: "scanner", payload: summary });
  return summary;
}
