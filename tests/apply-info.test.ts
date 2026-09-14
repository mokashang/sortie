import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile } from "@/lib/profile";
import { takeNextApplication, reportFill, confirmStatus } from "@/apply/queue";
import { pendingInfo, answerInfo, needsInfoNotification } from "@/apply/info";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

const yaml = `
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
directions:
  swe_general: 1
standard_answers:
  city: "Los Angeles, CA"
`;

function seed(db: DB, status = "prepared"): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Palantir", "FDSE New Grad", "https://jobs.lever.co/palantir/x", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", 85, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, status);
  return jobId;
}
const app = (db: DB, id: number) => db.prepare("SELECT * FROM applications WHERE job_id=?").get(id) as Record<string, unknown>;

const QUESTIONS = [
  { key: "high_school", label: "High School Name" },
  { key: "high_school_grad_year", label: "Year of High School Graduation", options: ["2020", "2021", "2022"] },
];

describe("needs_info round trip (executor asks -> user answers on /apply -> executor continues)", () => {
  it("reportFill needs_info stores the questions and moves prepared -> needs_info", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: QUESTIONS });
    expect(app(db, jobId).status).toBe("needs_info");
    expect(JSON.parse(app(db, jobId).pending_questions as string)).toEqual(QUESTIONS);
    expect(confirmStatus(db, U, jobId)).toEqual({ decision: null, status: "needs_info", infoAnswers: null });
    const pending = pendingInfo(db, U);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jobId, company: "Palantir", status: "needs_info", questions: QUESTIONS });
  });

  it("refuses needs_info without questions, and from a status that isn't mid-fill", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    expect(() => reportFill(db, U, { jobId, status: "needs_info", questions: [] })).toThrow();
    const matched = seed(db, "matched");
    expect(() => reportFill(db, U, { jobId: matched, status: "needs_info", questions: QUESTIONS })).toThrow();
  });

  it("answerInfo: persists remembered answers, keeps 仅本次 ones on the row, flips needs_info -> prepared with infoAnswers for the executor", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: QUESTIONS });
    const persisted: Record<string, string>[] = [];
    const result = answerInfo(
      db,
      U,
      jobId,
      { high_school: { value: " Chengdu No.7 " }, high_school_grad_year: { value: "2021", remember: false } },
      (r) => persisted.push(r)
    );
    expect(result).toEqual({ remembered: { high_school: "Chengdu No.7" }, status: "prepared" });
    expect(persisted).toEqual([{ high_school: "Chengdu No.7" }]);
    expect(app(db, jobId).status).toBe("prepared");
    expect(app(db, jobId).pending_questions).toBeNull();
    expect(confirmStatus(db, U, jobId)).toEqual({
      decision: null,
      status: "prepared",
      infoAnswers: { high_school: "Chengdu No.7", high_school_grad_year: "2021" },
    });
    expect(pendingInfo(db, U)).toEqual([]);
    // the executor can now carry on and report the fill as usual
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { "High School": "Chengdu No.7" } });
    expect(app(db, jobId).status).toBe("awaiting_confirm");
  });

  it("answerInfo validates: every question answered, select answers must be one of the options", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: QUESTIONS });
    expect(() => answerInfo(db, U, jobId, { high_school: { value: "X" } }, () => {})).toThrow(/missing answer/);
    expect(() =>
      answerInfo(db, U, jobId, { high_school: { value: "X" }, high_school_grad_year: { value: "1999" } }, () => {})
    ).toThrow(/not one of the options/);
    expect(app(db, jobId).status).toBe("needs_info");
  });

  it("executor timeout: needs_manual keeps the questions; answering then unparks the job and the next take carries the answers", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: QUESTIONS });
    reportFill(db, U, { jobId, status: "needs_manual", reason: "info request timed out after 30 minutes" });
    expect(app(db, jobId).status).toBe("matched");
    expect(app(db, jobId).pending_questions).not.toBeNull();
    const pending = pendingInfo(db, U);
    expect(pending[0]).toMatchObject({ status: "matched", needsManualReason: "info request timed out after 30 minutes" });

    const result = answerInfo(
      db,
      U,
      jobId,
      { high_school: { value: "Chengdu No.7", remember: false }, high_school_grad_year: { value: "2021", remember: false } },
      () => {
        throw new Error("nothing should be persisted when everything is 仅本次");
      }
    );
    expect(result.status).toBe("matched");
    expect(app(db, jobId).needs_manual_reason).toBeNull();

    db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run(
      "swe_general_v1",
      JSON.stringify(["swe_general"]),
      "/tmp/r.pdf",
      "2026-01-01 00:00:00"
    );
    const task = takeNextApplication(db, U, parseProfile(yaml), { direction: "swe_general" });
    expect("jobId" in task && task.jobId).toBe(jobId);
    expect("answerPack" in task && task.answerPack.custom).toMatchObject({
      city: "Los Angeles, CA",
      high_school: "Chengdu No.7",
      high_school_grad_year: "2021",
    });
  });

  it("optional questions may be left blank and are then simply not stored", () => {
    const db = openDb(":memory:");
    const jobId = seed(db);
    reportFill(db, U, {
      jobId,
      status: "needs_info",
      questions: [{ key: "high_school", label: "High School" }, { key: "essay_numbers", label: "Three numbers", optional: true }],
    });
    const r = answerInfo(db, U, jobId, { high_school: { value: "X" }, essay_numbers: { value: "  " } }, () => {});
    expect(r.status).toBe("prepared");
    expect(confirmStatus(db, U, jobId).infoAnswers).toEqual({ high_school: "X" });
  });

  it("needsInfoNotification names the company, count and where to go", () => {
    const n = needsInfoNotification("Palantir", "FDSE New Grad", QUESTIONS);
    expect(n.title).toContain("Palantir");
    expect(n.title).toContain("2 项");
    expect(n.body).toContain("High School Name");
    expect(n.body).toContain("待补信息");
  });
});
