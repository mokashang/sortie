import type { RankedCompany, RankedState } from "@/apply/ranking";

// Client-side logic of the 天梯 tab. Pure, so tests/apply-ranking.test.ts covers it.
export const RANKING_FILTERS = ["all", "todo", "you", "submitted", "archived"] as const;
export type RankingFilter = (typeof RANKING_FILTERS)[number];

const NEEDS_USER: ReadonlySet<RankedState> = new Set<RankedState>(["login", "submit", "action", "text", "manual"]);

export const needsUser = (s: RankedState): boolean => NEEDS_USER.has(s);

// What 投选中的 can do something with: a job not started, or a card it hands back. A login wall waits
// for the user to sign in, and the rest are done or in hand.
export const pickable = (s: RankedState): boolean => s === "todo" || (needsUser(s) && s !== "login");

function matches(s: RankedState, f: RankingFilter): boolean {
  if (f === "all") return true;
  if (f === "you") return needsUser(s);
  return s === f;
}

// A company stays when a job of it matches, with only those jobs. Under 全部 a company with no jobs
// this round keeps its row and its note ("近 60 天已投 3 份").
export function filterCompanies(companies: RankedCompany[], filter: RankingFilter, query: string): RankedCompany[] {
  const q = query.trim().toLowerCase();
  const out: RankedCompany[] = [];
  for (const c of companies) {
    if (q && !c.company.toLowerCase().includes(q)) continue;
    const jobs = c.jobs.filter((j) => matches(j.state, filter));
    if (jobs.length > 0 || (filter === "all" && c.jobs.length === 0)) out.push({ ...c, jobs });
  }
  return out;
}

export function filterCounts(companies: RankedCompany[]): Record<RankingFilter, number> {
  const n: Record<RankingFilter, number> = { all: 0, todo: 0, you: 0, submitted: 0, archived: 0 };
  for (const c of companies) {
    for (const j of c.jobs) {
      n.all++;
      if (needsUser(j.state)) n.you++;
      else if (j.state === "todo" || j.state === "submitted" || j.state === "archived") n[j.state]++;
    }
  }
  return n;
}
