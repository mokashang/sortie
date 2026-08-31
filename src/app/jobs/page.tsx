import { getDb } from "@/lib/db";
import { ScanButton } from "./scan-button";

export const dynamic = "force-dynamic";

interface JobRow {
  id: number; company: string; title: string; location: string | null;
  source: string; job_kind: string; visa_flag: string | null;
  apply_url: string; created_at: string;
}

export default function JobsPage() {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, company, title, location, source, job_kind, visa_flag, apply_url, created_at
       FROM jobs WHERE visa_flag IS NULL ORDER BY created_at DESC LIMIT 1000`
    )
    .all() as JobRow[];
  // "总计" must count the same population the table draws from (visa_flag IS NULL) — counting
  // ALL jobs (including visa-flagged ones the table never shows) made the displayed/total ratio
  // meaningless. totalAll is still needed to report how many were hidden for visa reasons.
  const totalVisible = (db.prepare("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NULL").get() as { n: number }).n;
  const totalAll = (db.prepare("SELECT COUNT(*) n FROM jobs").get() as { n: number }).n;
  const hidden = totalAll - totalVisible;

  return (
    <div>
      <h1>
        职位{" "}
        <small>
          (显示 {jobs.length} / 共 {totalVisible},已隐藏 {hidden} 个签证不符)
        </small>
      </h1>
      <ScanButton />
      <table>
        <thead>
          <tr><th>公司</th><th>标题</th><th>地点</th><th>类型</th><th>来源</th><th>入库时间</th><th></th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.company}</td>
              <td>{j.title}</td>
              <td>{j.location ?? "—"}</td>
              <td>{j.job_kind}</td>
              <td>{j.source}</td>
              <td>{j.created_at.slice(0, 16)}</td>
              <td><a href={j.apply_url} target="_blank" rel="noreferrer">原帖</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
