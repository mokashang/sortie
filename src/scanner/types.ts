export type JobSource =
  | "github_list" | "greenhouse" | "lever" | "ashby" | "workday" | "bytedance" | "smartrecruiters" | "oracle"
  | "icims" | "workable" | "amazon" | "linkedin" | "handshake" | "tesla"
  // A posting the user handed the 问助手 chat by URL (src/assistant/tools.ts).
  | "manual";

export interface RawJob {
  company: string;
  title: string;
  location: string | null;
  jdText: string; // 纯文本 JD;抓不到则空串
  applyUrl: string;
  source: JobSource;
  ats: string | null;
  postedAt: string | null; // ISO
  // 部分来源(如 github_list)有权威的 intern/newgrad 判定,直接携带;其余来源留空,
  // 由编排器用 jobKindFromTitle(r.title) 兜底判定。
  jobKind?: "intern" | "newgrad";
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
