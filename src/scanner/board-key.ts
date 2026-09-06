export type Family =
  | "greenhouse" | "lever" | "ashby" | "workday" | "bytedance" | "smartrecruiters" | "oracle"
  | "icims" | "workable" | "amazon" | "linkedin" | "github_list" | "chrome";

export const FAMILIES: Family[] = [
  "greenhouse", "lever", "ashby", "workday", "bytedance", "smartrecruiters", "oracle",
  "icims", "workable", "amazon", "linkedin", "github_list", "chrome",
];

export interface ParsedBoard { family: Family; ident: string; key: string; ats: string | null; }

const mk = (family: Family, ident: string, ats: string | null = family): ParsedBoard => ({ family, ident, key: `${family}:${ident}`, ats });

// 认得出 ATS 但本轮不轮询的主机:只回 ats,不建板块。
const ATS_ONLY: [RegExp, string][] = [
  [/(^|\.)eightfold\.ai$/, "eightfold"],
  [/successfactors|(^|\.)sap\.com$/, "successfactors"],
  [/(^|\.)taleo\.net$/, "taleo"],
  [/(^|\.)jobvite\.com$/, "jobvite"],
  [/(^|\.)bamboohr\.com$/, "bamboohr"],
  [/(^|\.)rippling\.com$/, "rippling"],
  [/(^|\.)recruitee\.com$/, "recruitee"],
  [/(^|\.)breezy\.hr$/, "breezy"],
];

// 从任意 apply_url 推出"这家公司用哪套招聘系统、板块标识是什么"。清单里每个岗位的链接都是一条
// 可轮询板块的证据(spec 2026-09-06 §1.2)。认不出或标识不完整 → null。
export function parseBoard(url: string | null | undefined): ParsedBoard | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  let m: RegExpMatchArray | null;

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (segs[0] === "embed") { const t = u.searchParams.get("for"); return t ? mk("greenhouse", t.toLowerCase()) : null; }
    return segs[0] ? mk("greenhouse", segs[0].toLowerCase()) : null;
  }
  if (/(^|\.)lever\.co$/.test(host)) return segs[0] ? mk("lever", segs[0].toLowerCase()) : null;
  if (host === "jobs.ashbyhq.com") return segs[0] ? mk("ashby", segs[0].toLowerCase()) : null;
  if ((m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/))) {
    const s = [...segs];
    if (s[0] && /^[a-z]{2}-[A-Za-z]{2}$/.test(s[0])) s.shift(); // /en-US/<site>/…
    if (!s[0] || ["job", "details", "jobs"].includes(s[0].toLowerCase())) return null;
    return mk("workday", `${m[1]}.${m[2]}/${s[0]}`);
  }
  if ((m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdaysite\.com$/))) {
    return segs[0] === "recruiting" && segs[2] ? mk("workday", `${m[1]}.${m[2]}/${segs[2]}`) : null;
  }
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return segs[0] && segs[0] !== "job" ? mk("smartrecruiters", segs[0]) : null;
  if (/(^|\.)oraclecloud\.com$/.test(host)) {
    const i = segs.indexOf("sites");
    return i >= 0 && segs[i + 1] ? mk("oracle", `${host}/${segs[i + 1]}`) : null;
  }
  if (/(^|\.)icims\.com$/.test(host)) return mk("icims", host);
  if (host === "apply.workable.com") return segs[0] && segs[0] !== "j" ? mk("workable", segs[0].toLowerCase()) : null;
  if ((m = host.match(/^([a-z0-9-]+)\.workable\.com$/)) && !["www", "apply", "jobs"].includes(m[1])) return mk("workable", m[1]);
  if (/(^|\.)lifeattiktok\.com$/.test(host)) return mk("bytedance", "tiktok", "bytedance");
  if (/(^|\.)(bytedance|joinbytedance|toutiao)\.com$/.test(host)) return mk("bytedance", "bytedance", "bytedance");
  if (/(^|\.)amazon\.jobs$/.test(host)) return mk("amazon", "us", "amazon");
  if (/(^|\.)linkedin\.com$/.test(host) && segs[0] === "jobs") return mk("linkedin", "guest", null);
  if (/(^|\.)tesla\.com$/.test(host) && segs[0] === "careers") return mk("chrome", "tesla", "tesla");
  if (/(^|\.)joinhandshake\.com$/.test(host)) return mk("chrome", "handshake", null);
  return null;
}

// jobs.ats 用:能建板块的直接取 family;自定义域 gh_jid / 站点缺失的 Workday、Oracle / 不轮询的 ATS 也给出族名。
export function atsFromUrl(url: string | null | undefined): string | null {
  const b = parseBoard(url);
  if (b) return b.ats;
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (u.searchParams.has("gh_jid") || /(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
  if (/myworkday(jobs|site)\.com$/.test(host)) return "workday";
  if (/(^|\.)oraclecloud\.com$/.test(host)) return "oracle";
  for (const [re, ats] of ATS_ONLY) if (re.test(host)) return ats;
  return null;
}
