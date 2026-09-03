import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface JobDetailRow {
  title: string;
  company: string;
  location: string | null;
  apply_url: string | null;
  jd_text: string | null;
  direction: string | null;
  score: number | null;
  tier: number | null;
  reason: string | null;
  resume_version: string | null;
  jd_status: string | null;
  duplicate_of: number | null;
  sponsorship: string | null;
  degree_req: string | null;
  role_kind: string | null;
  skip_reason: string | null;
  sibling_locations: string | null;
}

// GET /api/jobs/[id] — the interactive /queue page's row-expand ("展开 JD 与打分理由") drawer
// data source. LEFT JOINs matches/resumes so a job that hasn't been scored yet (or whose match
// has no resume picked out for it) still resolves cleanly with null fields, rather than the row
// vanishing from a plain INNER JOIN.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "invalid job id" }, { status: 400 });
  }

  const row = getDb()
    .prepare(
      `SELECT j.title, j.company, j.location, j.apply_url, j.jd_text,
              m.direction, m.score, m.tier, m.reason,
              r.version_name as resume_version,
              j.jd_status, j.duplicate_of, j.sponsorship, j.degree_req, j.role_kind, m.skip_reason,
              (SELECT group_concat(d.location, ' | ') FROM jobs d WHERE d.duplicate_of = j.id) AS sibling_locations
       FROM jobs j
       LEFT JOIN matches m ON m.job_id = j.id
       LEFT JOIN resumes r ON r.id = m.resume_id
       WHERE j.id = ?`
    )
    .get(jobId) as JobDetailRow | undefined;

  if (!row) {
    return NextResponse.json({ error: `no job with id ${jobId}` }, { status: 404 });
  }

  return NextResponse.json({
    title: row.title,
    company: row.company,
    location: row.location,
    apply_url: row.apply_url,
    jd_text: row.jd_text,
    match: {
      direction: row.direction,
      score: row.score,
      tier: row.tier,
      reason: row.reason,
    },
    resume_version: row.resume_version,
    jd_status: row.jd_status,
    duplicate_of: row.duplicate_of,
    sponsorship: row.sponsorship,
    degree_req: row.degree_req,
    role_kind: row.role_kind,
    skip_reason: row.skip_reason,
    sibling_locations: row.sibling_locations,
  });
}
