import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportJdReview, reportFromFormData, JdReviewReport } from "@/jd-review/service";
import { withUser, failResponse, requireOwner } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// The jd_review executor posts as application/x-www-form-urlencoded (see reportFromFormData in
// src/jd-review/service.ts for why); this route accepts either that or JSON, normalizing both
// into the same JdReviewReport shape before calling reportJdReview.
export const POST = withUser(async (req, actor) => {
  // A report rewrites the shared posting (its JD, its eligibility) and archives it for every
  // account, so only the owner's jd_review run (the only one that runs) may send one.
  requireOwner(actor);
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let body: JdReviewReport;
    if (contentType.includes("application/json")) {
      body = (await readJsonBody(req)) as JdReviewReport;
      body = { ...body, jobId: Number(body.jobId) };
    } else {
      body = reportFromFormData(await req.formData());
    }
    return NextResponse.json(reportJdReview(getDb(), body));
  } catch (e) {
    return failResponse(e);
  }
});
