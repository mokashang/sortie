import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportJdReview, reportFromFormData, JdReviewReport } from "@/jd-review/service";

// The jd_review executor posts as application/x-www-form-urlencoded (see reportFromFormData in
// src/jd-review/service.ts for why); this route accepts either that or JSON, normalizing both
// into the same JdReviewReport shape before calling reportJdReview.
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
