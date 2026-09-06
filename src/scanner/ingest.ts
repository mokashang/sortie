import { z } from "zod";
import { DB } from "@/lib/db";
import { upsertJobs, UpsertSummary } from "@/scanner/upsert";
import { getBoard, iso, upsertBoards } from "@/scanner/boards";

// Chrome 扫描 run(值守会话)抄回来的岗位:zod 校验后走和其他来源一模一样的 upsert;
// chrome:* 板块盖 last_ok_at,来源页能看到"上次跑"。
export const IngestJobSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  location: z.string().max(300).nullable().optional(),
  jdText: z.string().max(40_000).default(""),
  applyUrl: z.string().url().refine((u) => /^https?:\/\//i.test(u), "http(s) only"),
  source: z.enum(["linkedin", "handshake", "tesla"]),
  postedAt: z.string().max(40).nullable().optional(),
  jobKind: z.enum(["intern", "newgrad"]).optional(),
});
export type IngestJob = z.infer<typeof IngestJobSchema>;
export const IngestBodySchema = z.object({ runId: z.number().int().optional(), jobs: z.array(IngestJobSchema).min(1).max(200) });

export const chromeBoardKey = (source: IngestJob["source"]) => `chrome:${source}` as const;

export function ingestJobs(db: DB, jobs: IngestJob[], opts: { now?: Date } = {}): UpsertSummary & { boards: string[] } {
  const now = opts.now ?? new Date();
  const boards = new Set<string>();
  const total: UpsertSummary = { inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, errors: [] };
  for (const source of ["linkedin", "handshake", "tesla"] as const) {
    const rows = jobs.filter((j) => j.source === source);
    if (!rows.length) continue;
    const key = chromeBoardKey(source);
    boards.add(key);
    if (!getBoard(db, key)) upsertBoards(db, [{ key, origin: "builtin" }]);
    const s = upsertJobs(
      db,
      rows.map((j) => ({ company: j.company, title: j.title, location: j.location ?? null, jdText: j.jdText ?? "", applyUrl: j.applyUrl, source, ats: source === "tesla" ? "tesla" : null, postedAt: j.postedAt ?? null, jobKind: j.jobKind })),
      { boardKey: key }
    );
    for (const k of ["inserted", "upgraded", "duplicates", "visaSkipped", "locSkipped"] as const) total[k] += s[k];
    total.errors.push(...s.errors);
    db.prepare("UPDATE boards SET last_polled_at=?, last_ok_at=?, last_error=NULL, updated_at=datetime('now') WHERE key=?").run(iso(now), iso(now), key);
  }
  return { ...total, boards: [...boards] };
}

export function knownUrls(db: DB, urls: string[]): string[] {
  const stmt = db.prepare("SELECT 1 FROM jobs WHERE apply_url = ?");
  return urls.filter((u) => !!stmt.get(u));
}
