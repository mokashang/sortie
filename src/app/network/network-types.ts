// Client-side mirrors of src/network/crm.ts's constants and row shapes. Duplicated (not imported)
// because crm.ts pulls in the native sqlite module, which cannot be bundled for the browser.
export const RELATIONS = ["recruiter", "alum", "hiring_manager", "engineer", "other"] as const;
// 'referral' is deliberately absent: referral requests live on 投递's 内推进行中 board.
export const NETWORK_PLAYBOOKS = ["coffee_chat", "hidden_opportunity", "self_pitch", "recruiter", "followup", "thanks"] as const;
export const CHANNELS = ["linkedin", "email"] as const;

export interface Person {
  id: number;
  name: string;
  company: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  relation: string | null;
}

export interface ThreadEntry {
  at: string;
  dir: "sent" | "received";
  text: string;
}

export interface OutreachRow {
  id: number;
  personId: number;
  personName: string;
  personCompany: string | null;
  jobId: number | null;
  playbook: string;
  channel: string;
  draft: string | null;
  threadLog: ThreadEntry[];
  status: string;
  outcome: string | null;
  createdAt: string;
}

export interface SendableRow {
  id: number;
  personId: number;
  personName: string;
  linkedinUrl: string | null;
  email: string | null;
  channel: string;
  playbook: string;
  draft: string | null;
  jobId: number | null;
}

export interface JobLite {
  id: number;
  company: string;
  title: string;
}

export function parseEmailDraft(draft: string): { subject: string; body: string } {
  const m = draft.match(/^Subject: (.*)\n\n([\s\S]*)$/);
  if (m) return { subject: m[1], body: m[2] };
  return { subject: "", body: draft };
}

export function mailtoFor(row: SendableRow): string | null {
  if (row.channel !== "email" || !row.email) return null;
  const parsed = row.draft ? parseEmailDraft(row.draft) : null;
  return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(parsed?.subject ?? "")}&body=${encodeURIComponent(parsed?.body ?? row.draft ?? "")}`;
}
