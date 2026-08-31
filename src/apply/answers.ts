import { Profile } from "@/lib/profile";

export interface AnswerPack {
  contact: {
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
    phone: string;
    linkedin_url: string;
    github_url: string;
    location: string;
  };
  education: { school: string; degree: string; grad_month_year: string };
  work_auth: { authorized_to_work_us: "Yes" | "No"; requires_sponsorship: "Yes" | "No" };
  eeo: { gender: string; race: string; veteran: string; disability: string };
  resume: { version_name: string; pdf_path: string };
  custom: Record<string, string>;
  job: { company: string; title: string; apply_url: string };
}

export interface AnswerPackJob {
  company: string;
  title: string;
  apply_url?: string | null;
}

export interface AnswerPackResume {
  version_name: string;
  pdf_path?: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// grad_date is validated upstream (ProfileSchema) as strict YYYY-MM.
function formatGradMonthYear(gradDate: string): string {
  const [year, month] = gradDate.split("-");
  const idx = Number(month) - 1;
  const monthName = MONTHS[idx] ?? month;
  return `${monthName} ${year}`;
}

// Splits on the LAST space so multi-word first names ("Mary Jane Watson") keep "Mary Jane"
// together as the first name and only the trailing token becomes the last name. Collapses
// runs of internal whitespace first so a stray double space (copy-paste artifact in profile.yaml)
// doesn't produce an empty middle token or throw off which space is "last".
function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
}

// Bare handles like "linkedin.com/in/x" get an https:// prefix; anything already carrying a
// scheme (http:// or https://) is left exactly as the user wrote it. An empty/unset value stays
// empty — profile.yaml allows linkedin/github to be blank, and turning "" into "https://" would
// hand the executor a fake, non-functional URL to type into a form.
function completeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function buildAnswerPack(profile: Profile, job: AnswerPackJob, resume: AnswerPackResume): AnswerPack {
  const { first, last } = splitName(profile.name);

  return {
    contact: {
      first_name: first,
      last_name: last,
      full_name: profile.name,
      email: profile.email,
      phone: profile.phone,
      linkedin_url: completeUrl(profile.linkedin),
      github_url: completeUrl(profile.github),
      // profile.yaml has no location field yet — default to empty rather than guessing.
      location: "",
    },
    education: {
      school: profile.school,
      degree: profile.degree,
      grad_month_year: formatGradMonthYear(profile.grad_date),
    },
    work_auth: {
      // Truthful mapping, never fabricated: this app only tracks candidates who are currently
      // eligible to work in the US (e.g. F-1 via CPT/OPT, citizen, green card, existing visa).
      authorized_to_work_us: "Yes",
      requires_sponsorship: profile.work_auth.needs_sponsorship ? "Yes" : "No",
    },
    eeo: { ...profile.eeo },
    resume: { version_name: resume.version_name, pdf_path: resume.pdf_path ?? "" },
    custom: { ...profile.standard_answers },
    job: { company: job.company, title: job.title, apply_url: job.apply_url ?? "" },
  };
}
