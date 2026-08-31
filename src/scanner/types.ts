export interface RawJob {
  company: string;
  title: string;
  location: string | null;
  jdText: string; // 纯文本 JD;抓不到则空串
  applyUrl: string;
  source: "github_list" | "greenhouse" | "lever" | "ashby";
  ats: string | null;
  postedAt: string | null; // ISO
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
