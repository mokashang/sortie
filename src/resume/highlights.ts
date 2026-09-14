import type { Experience } from "@/resume/experiences";

// One real thing the candidate has done, offered to a drafting model as material for the "one
// concrete thing" line (outreach messages, src/network/draft.ts) or for a cover letter / free-text
// essay the apply executor drafts into a form (answerPack.experiences). Built from the
// experiences table (work + project only — skills lists and coursework don't make a story), the
// bullet closest to the target direction(s) first.
export interface Highlight {
  kind: string;
  title: string;
  organization: string | null;
  bullet: string;
}

export const MAX_HIGHLIGHTS = 6;
const HIGHLIGHT_BULLET_CHARS = 220;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

// Pure. `directions` are the slugs the message/form is about (the jobs' matched directions, or
// the profile's tier-1 directions when there is no job); entries whose bullets are tagged with
// them rank first, work before projects, then the resume's own sort order.
export function pickHighlights(experiences: Experience[], directions: string[], max = MAX_HIGHLIGHTS): Highlight[] {
  const wanted = new Set(directions);
  const scored = experiences
    .filter((e) => e.kind === "work" || e.kind === "project")
    .map((e) => {
      const hits = e.bullets.filter((b) => b.directions.some((d) => wanted.has(d)));
      const bullet = (hits[0] ?? e.bullets[0])?.text ?? "";
      return { e, hits: hits.length, bullet };
    })
    .filter((x) => x.bullet);
  const kindRank = (e: Experience) => (e.kind === "work" ? 0 : 1);
  scored.sort((a, b) => b.hits - a.hits || kindRank(a.e) - kindRank(b.e) || a.e.sort_order - b.e.sort_order || a.e.id - b.e.id);
  return scored.slice(0, max).map(({ e, bullet }) => ({
    kind: e.kind,
    title: e.title,
    organization: e.organization ?? null,
    bullet: clip(bullet, HIGHLIGHT_BULLET_CHARS),
  }));
}
