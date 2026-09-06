import { DB } from "@/lib/db";
import { BoardSpec, iso, upsertBoards } from "@/scanner/boards";

// 开源公司目录(zshah101):4725 家公司的 ATS + 标识。一次性导入为 longtail,next_due_at 在 72 小时内
// 均匀错开,让打分器跟得上(spec §3.4)。不把这个文件当运行时依赖。
export const DIRECTORY_URL = "https://raw.githubusercontent.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/main/data/companies.json";
export interface DirectoryEntry { name: string; slug: string; ats: string; wd?: string; site?: string; host?: string; }

export function directoryToSpecs(entries: DirectoryEntry[]): BoardSpec[] {
  const out: BoardSpec[] = [];
  for (const e of entries) {
    let key: string | null = null;
    switch (e.ats) {
      case "greenhouse": case "lever": case "ashby": key = `${e.ats}:${e.slug.toLowerCase()}`; break;
      case "workday": if (e.wd && e.site) key = `workday:${e.slug.toLowerCase()}.${e.wd}/${e.site}`; break;
      case "smartrecruiters": key = `smartrecruiters:${e.slug}`; break;
      case "oracle": if (e.host && e.site) key = `oracle:${e.host.toLowerCase()}/${e.site}`; break;
      case "workable": key = `workable:${e.slug.toLowerCase()}`; break;
      default: key = null; // rippling / recruitee / breezy / eightfold / amazon:本轮不做或已内置
    }
    if (key) out.push({ key, company: e.name, origin: "directory" });
  }
  return out;
}

export function importDirectory(db: DB, entries: DirectoryEntry[], opts: { now: Date; spreadHours?: number; rand?: () => number }): { inserted: number; skipped: number } {
  const specs = directoryToSpecs(entries);
  const exists = db.prepare("SELECT 1 FROM boards WHERE key = ?");
  const fresh = specs.filter((s) => !exists.get(s.key));
  const r = upsertBoards(db, fresh);
  const rand = opts.rand ?? Math.random;
  const spread = (opts.spreadHours ?? 72) * 3600_000;
  const upd = db.prepare("UPDATE boards SET next_due_at = ? WHERE key = ?");
  db.transaction(() => { for (const s of fresh) upd.run(iso(new Date(opts.now.getTime() + rand() * spread)), s.key); })();
  return { inserted: r.inserted, skipped: specs.length - fresh.length };
}
