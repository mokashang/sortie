import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadProfile, saveStandardAnswers } from "@/lib/profile";

const yamlWithComments = `# my profile
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1   # keep this comment
  needs_sponsorship: true
targets:
  primary: newgrad
directions:
  swe_general: 1
standard_answers:
  city: "Los Angeles, CA"
  how_did_you_hear: "Job board"
eeo:
  gender: "Male"
`;

describe("saveStandardAnswers (the /profile 标准答案 editor's write path)", () => {
  it("replaces standard_answers, keeps every other key and the file's comments, and reloads cleanly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-profile-"));
    const file = path.join(dir, "profile.yaml");
    fs.writeFileSync(file, yamlWithComments);

    saveStandardAnswers({ city: "Los Angeles, CA", high_school: "Chengdu No.7 High School", high_school_grad_year: "2021" }, file);

    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("# my profile");
    expect(text).toContain("# keep this comment");
    expect(text).not.toContain("how_did_you_hear");
    const p = loadProfile(file);
    expect(p.standard_answers).toEqual({
      city: "Los Angeles, CA",
      high_school: "Chengdu No.7 High School",
      high_school_grad_year: "2021",
    });
    expect(p.eeo.gender).toBe("Male");
    expect(p.work_auth.needs_sponsorship).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("drops blank keys and trims values; refuses a non-string value", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-profile-"));
    const file = path.join(dir, "profile.yaml");
    fs.writeFileSync(file, yamlWithComments);
    saveStandardAnswers({ "  ": "ignored", relocation: "  New York, Boston  " }, file);
    expect(loadProfile(file).standard_answers).toEqual({ relocation: "New York, Boston" });
    expect(() => saveStandardAnswers({ x: 5 as unknown as string }, file)).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
