import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";
import { locFlag } from "@/scanner/location-filter";
import { httpError, pastDeadline, readJson, rotate, wanted } from "@/scanner/sources/util";

// Workday 站点自己用的 JSON 接口(CXS,未文档化但所有租户一致)。列表不含正文,新岗再拉一次详情。
// 关键词逐个搜(接口不支持 OR),按 externalPath 去重。searchText 是全文模糊搜索:CVS 这种大租户
// 「new grad」能搜出近 6000 条(绝大多数是药房 / 门店岗),所以详情只给过得了标题门的新岗拉,
// 并且整个板块受调度器给的截止时刻约束(ctx.deadline)。
const KEYWORDS = ["new grad", "new college grad", "graduate", "intern", "early career", "university", "entry level", "campus"];
const PAGE = 20;
// 结果按相关度排序,越往后越是沾边的模糊匹配:一个词连续这么多页没有「会留下」的岗(入门级、过标题门、
// 不是明确的非美国)就不再往后翻。2026-10-22 用真实列表离线回放过(四种关键词顺序):CVS 一次轮询的列表请求
// 70 → 约 25,少拿到的全是第 6 页以后的 Medical Claim Analyst 之类;NVIDIA(种子,不设门)190 个一个不少。
export const DRY_PAGES = 2;
// Workday 会把租户整体搬到别的 pod(wdN 变了:comcast、cmu wd5 → wd115,netflix wd1 → wd108,symbotic wd1 → wd504),
// 老 pod 对 CXS 一律回 422、也不跳转。第一次 422 时按这个顺序(我们板块里的常见程度)把同租户同站点在别的 pod 上
// 各问一次(limit 1),找到就改用新地址,并告诉调度器(ctx.moved);都没有就记下来,30 天内不再试。
export const WORKDAY_PODS = ["wd1", "wd5", "wd3", "wd12", "wd108", "wd501", "wd503", "wd103", "wd10", "wd504", "wd115", "wd102", "wd107", "wd105", "wd502"];
const POD_PROBE_EVERY_MS = 30 * 86_400_000;
interface Posting { title: string; externalPath: string; locationsText?: string; postedOn?: string; }
interface Detail { jobPostingInfo?: { jobDescription?: string; startDate?: string; location?: string; additionalLocations?: string[] } }

const cxsOf = (tenant: string, wd: string, site: string) => `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;
const listBody = (kw: string, offset: number, limit = PAGE) => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: kw }),
});

// 同租户同站点在别的 pod 上找。返回新 pod;没找到(或被截止时刻打断)返回 null。
async function findPod(board: BoardRow, ctx: FetchCtx, tenant: string, wd: string, site: string): Promise<string | null> {
  let meta: { pod_probe_at?: string } = {};
  try { meta = board.meta ? (JSON.parse(board.meta) as typeof meta) : {}; } catch { meta = {}; }
  if (meta.pod_probe_at && ctx.now.getTime() - Date.parse(meta.pod_probe_at) < POD_PROBE_EVERY_MS) return null;
  for (const pod of WORKDAY_PODS) {
    if (pod === wd) continue;
    if (pastDeadline(ctx)) return null;                      // 没问完:不记,下次接着试
    try {
      const r = await ctx.fetcher(`${cxsOf(tenant, pod, site)}/jobs`, { ...listBody("", 0, 1), signal: AbortSignal.timeout(10_000) });
      if (r.ok) return pod;
    } catch { /* 这个 pod 上没有这个租户 / 连不上 */ }
  }
  ctx.setMeta?.({ pod_probe_at: ctx.now.toISOString() });
  return null;
}

export async function fetchWorkday(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const [tenantWd, site] = board.ident.split("/");
  const [tenant, wd] = (tenantWd ?? "").split(".");
  if (!tenant || !wd || !site) throw new Error(`workday ${board.ident}: bad ident`);
  let pod = wd;
  let cxs = cxsOf(tenant, pod, site);
  const maxPages = ctx.depth === "core" ? 15 : 5;   // 每词最多 300 / 100 条
  const seen = new Map<string, Posting>();
  const keeps = (p: Posting) => isEntryLevelTitle(p.title) && wanted(ctx, p.title) && !locFlag(p.locationsText ?? null);
  let cut = false, requests = 0;
  list: for (const kw of rotate(KEYWORDS, ctx.now)) {
    let dry = 0;
    for (let page = 0; page < maxPages; page++) {
      if (requests++ > 0 && pastDeadline(ctx)) { cut = true; break list; }
      const signal = AbortSignal.timeout(20_000);
      let res = await ctx.fetcher(`${cxs}/jobs`, { ...listBody(kw, page * PAGE), signal });
      if (res.status === 422 && requests === 1) {
        const moved = await findPod(board, ctx, tenant, wd, site);
        if (moved) {
          pod = moved; cxs = cxsOf(tenant, pod, site);
          ctx.moved?.(`workday:${tenant}.${pod}/${site}`);
          res = await ctx.fetcher(`${cxs}/jobs`, { ...listBody(kw, page * PAGE), signal: AbortSignal.timeout(20_000) });
        }
      }
      if (!res.ok) throw httpError(`workday ${board.ident}`, res);
      const data = await readJson<{ jobPostings?: Posting[] }>(res, `workday ${board.ident}`);
      const posts = data.jobPostings ?? [];
      // 这一页有没有「会留下」的岗 —— 别的词已经搜到过的也算:不算的话,换了关键词顺序后
      // 「new grad」的前几页全是见过的,翻两页就停,NVIDIA 后面十来页独有的实习会漏掉(离线回放 190 → 179)。
      let keepable = 0;
      for (const p of posts) {
        if (!p.externalPath) continue;
        if (keeps(p)) keepable++;
        if (!seen.has(p.externalPath)) seen.set(p.externalPath, p);
      }
      if (posts.length < PAGE) break;
      dry = keepable ? 0 : dry + 1;
      if (dry >= DRY_PAGES) break;
    }
  }
  const base = `https://${tenant}.${pod}.myworkdayjobs.com`;
  const out: RawJob[] = [];
  for (const [path, p] of seen) {
    if (!keeps(p)) continue;                                  // 门外 / 非入门 / 明确非美国:不拉详情、不入库
    const applyUrl = `${base}/${site}${path}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    if (pastDeadline(ctx)) { cut = true; break; }             // 剩下的新岗这次不返回,下次轮询再拉
    let jdText = "", postedAt: string | null = null, location: string | null = p.locationsText ?? null;
    try {
      const d = await ctx.fetcher(`${cxs}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const info = ((await d.json()) as Detail).jobPostingInfo ?? {};
        jdText = htmlToText(info.jobDescription ?? "");
        postedAt = info.startDate ?? null;
        if (info.location) location = [info.location, ...(info.additionalLocations ?? [])].join("; ");
      }
    } catch { /* 详情失败:以空正文入库,jd_review 兜底 */ }
    out.push({ company: board.company ?? tenant, title: p.title, location, jdText, applyUrl, source: "workday", ats: "workday", postedAt });
  }
  if (cut) ctx.truncated?.();
  return out;
}
