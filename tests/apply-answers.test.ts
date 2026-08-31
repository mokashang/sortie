import { describe, it, expect } from "vitest";
import { parseProfile } from "@/lib/profile";
import { buildAnswerPack } from "@/apply/answers";

const baseYaml = `
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
  secondary: intern
directions:
  swe_general: 1
  ai_infra: 1
daily_minutes_budget: 90
`;

const job = { company: "Stripe", title: "SWE New Grad", apply_url: "https://job-boards.greenhouse.io/stripe/jobs/1" };
const resume = { version_name: "ai_infra-v1", pdf_path: "/data/resumes/ai_infra-v1.pdf" };

describe("buildAnswerPack", () => {
  it("splits the name on the last space into first/last", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.first_name).toBe("Mengjia");
    expect(pack.contact.last_name).toBe("Shang");
    expect(pack.contact.full_name).toBe("Mengjia Shang");
  });

  it("splits a multi-word first name on only the LAST space", () => {
    const profile = parseProfile(baseYaml.replace("name: Mengjia Shang", "name: Mary Jane Watson"));
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.first_name).toBe("Mary Jane");
    expect(pack.contact.last_name).toBe("Watson");
  });

  it("completes bare linkedin/github handles into full https URLs", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.linkedin_url).toBe("https://linkedin.com/in/mengjia-shang");
    expect(pack.contact.github_url).toBe("https://github.com/mokashang");
  });

  it("leaves already-complete https URLs untouched", () => {
    const profile = parseProfile(
      baseYaml
        .replace("linkedin: linkedin.com/in/mengjia-shang", "linkedin: https://linkedin.com/in/mengjia-shang")
        .replace("github: github.com/mokashang", "github: http://github.com/mokashang")
    );
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.linkedin_url).toBe("https://linkedin.com/in/mengjia-shang");
    expect(pack.contact.github_url).toBe("http://github.com/mokashang");
  });

  it("leaves an empty linkedin/github value empty instead of turning it into 'https://'", () => {
    const profile = parseProfile(baseYaml.replace("linkedin: linkedin.com/in/mengjia-shang", 'linkedin: ""'));
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.linkedin_url).toBe("");
  });

  it("normalizes internal whitespace in the name before splitting first/last", () => {
    const profile = parseProfile(baseYaml.replace("name: Mengjia Shang", 'name: "  Mengjia   Shang  "'));
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.contact.first_name).toBe("Mengjia");
    expect(pack.contact.last_name).toBe("Shang");
  });

  it("maps work authorization truthfully for an F-1 candidate who needs sponsorship", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.work_auth.authorized_to_work_us).toBe("Yes");
    expect(pack.work_auth.requires_sponsorship).toBe("Yes");
  });

  it("maps requires_sponsorship to No when the profile says sponsorship isn't needed — never lies about visa status", () => {
    const profile = parseProfile(baseYaml.replace("needs_sponsorship: true", "needs_sponsorship: false"));
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.work_auth.requires_sponsorship).toBe("No");
  });

  it("fills in EEO defaults when the profile has no eeo section", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.eeo).toEqual({
      gender: "Decline to self-identify",
      race: "Decline to self-identify",
      veteran: "I am not a protected veteran",
      disability: "I do not want to answer",
    });
  });

  it("passes through custom eeo values from the profile", () => {
    const withEeo =
      baseYaml + `eeo:\n  gender: Female\n  race: Asian\n  veteran: "I am not a protected veteran"\n  disability: "No"\n`;
    const profile = parseProfile(withEeo);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.eeo.gender).toBe("Female");
    expect(pack.eeo.race).toBe("Asian");
  });

  it("passes through standard_answers as custom", () => {
    const withCustom = baseYaml + `standard_answers:\n  "How did you hear about us": "Company website"\n`;
    const profile = parseProfile(withCustom);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.custom["How did you hear about us"]).toBe("Company website");
  });

  it("defaults custom to an empty object when standard_answers is absent", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.custom).toEqual({});
  });

  it("fills education from profile school/degree/grad_date", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.education.school).toBe("University of Southern California");
    expect(pack.education.degree).toBe("M.S. ECE");
    expect(pack.education.grad_month_year).toBe("May 2027");
  });

  it("passes through resume and job info", () => {
    const profile = parseProfile(baseYaml);
    const pack = buildAnswerPack(profile, job, resume);
    expect(pack.resume).toEqual({ version_name: "ai_infra-v1", pdf_path: "/data/resumes/ai_infra-v1.pdf" });
    expect(pack.job).toEqual({
      company: "Stripe",
      title: "SWE New Grad",
      apply_url: "https://job-boards.greenhouse.io/stripe/jobs/1",
    });
  });
});
