import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportJdReview, JdReviewReport } from "@/jd-review/service";

// The jd_review executor posts as application/x-www-form-urlencoded via `curl --data-urlencode`
// rather than JSON: hand-escaping a ~20k-char JD string into a JSON body from a shell script is
// fragile (quotes, newlines, control chars), while --data-urlencode handles that for free. So this
// route accepts either encoding and normalizes both into the same JdReviewReport shape.
function reportFromFormData(form: FormData): JdReviewReport {
  const get = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const jobIdRaw = get("jobId");
  return {
    jobId: Number(jobIdRaw),
    status: get("status") as JdReviewReport["status"],
    jdText: get("jdText"),
    sponsorship: get("sponsorship") as JdReviewReport["sponsorship"],
    degree: get("degree") as JdReviewReport["degree"],
    role: get("role") as JdReviewReport["role"],
    evidence: get("evidence"),
  };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let body: JdReviewReport;
    if (contentType.includes("application/json")) {
      body = (await req.json()) as JdReviewReport;
      body = { ...body, jobId: Number(body.jobId) };
    } else {
      body = reportFromFormData(await req.formData());
    }
    return NextResponse.json(reportJdReview(getDb(), body));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
