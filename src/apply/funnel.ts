// Sankey data for the /history funnel chart. Pure: HistoryRow[] in, nodes + links out, no React,
// no db — so the layout math is unit-testable and the chart component only has to draw.
//
// Shape (five layers, left to right):
//   submitted ─┬─> oa ─┬─> interview ─┬─> offer ─┬─> offer_accepted
//              │       │              │          └─> offer_declined
//              │       │              └─> drop_interview   (rejected/stale after interview)
//              │       └─> drop_oa                         (rejected/stale after OA)
//              ├─> drop_submitted                          (rejected/stale, never heard back)
//              └─> wait_submitted                          (no news yet)
//
// A row's path is decided by its peak (furthest rung reached) and its current status: it flows
// through every rung up to its peak and, if it has an outcome, on into that rung's outcome
// bucket. A row still in progress at OA / interview / offer simply stays inside that stage node
// (its count is in the node, nothing leaves) — the only "waiting" branch is at the first layer,
// so the total still adds up. Zero-count nodes and links are omitted so a young pipeline draws as
// a small chart, not a skeleton of empty boxes.

import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { PEAK_STAGES, PeakStage, PostSubmitStage, stageLabels } from "@/apply/stages";

export type FunnelKind = "stage" | "wait" | "drop" | "accept" | "decline";

export interface FunnelNode {
  id: string;
  layer: number; // 0 = submitted, 4 = offer outcomes
  label: string;
  count: number;
  kind: FunnelKind;
}

export interface FunnelLink {
  from: string;
  to: string;
  count: number;
}

export interface FunnelData {
  nodes: FunnelNode[];
  links: FunnelLink[];
}

export function buildFunnel(rows: { status: PostSubmitStage; peak: PeakStage }[], lang: Lang): FunnelData {
  const STAGE = stageLabels(lang);
  const F = messages[lang].stages.funnel;
  const DROP_LABELS: Record<Exclude<PeakStage, "offer">, string> = {
    submitted: F.dropSubmitted,
    oa: F.dropOa,
    interview: F.dropInterview,
  };

  const nodeCount = new Map<string, number>();
  const linkCount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of rows) {
    const peakIdx = PEAK_STAGES.indexOf(r.peak);
    // Pass through every rung up to and including the peak.
    for (let i = 0; i <= peakIdx; i++) {
      bump(nodeCount, PEAK_STAGES[i]);
      if (i > 0) bump(linkCount, `${PEAK_STAGES[i - 1]}>${PEAK_STAGES[i]}`);
    }
    // Then land in the peak rung's outcome bucket, if there is an outcome.
    let bucket: string | null = null;
    if (r.status === "offer_accepted" || r.status === "offer_declined") bucket = r.status;
    else if (r.status === "rejected" || r.status === "stale") bucket = `drop_${r.peak}`;
    else if (r.peak === "submitted") bucket = "wait_submitted";
    if (bucket) {
      bump(nodeCount, bucket);
      bump(linkCount, `${r.peak}>${bucket}`);
    }
  }

  const nodes: FunnelNode[] = [];
  const push = (id: string, layer: number, label: string, kind: FunnelKind) => {
    const count = nodeCount.get(id);
    if (count) nodes.push({ id, layer, label, count, kind });
  };
  PEAK_STAGES.forEach((stage, i) => {
    push(stage, i, STAGE[stage], "stage");
    // Outcomes of this rung sit one layer to the right, alongside the next rung.
    if (stage !== "offer") push(`drop_${stage}`, i + 1, DROP_LABELS[stage], "drop");
  });
  push("wait_submitted", 1, F.wait, "wait");
  push("offer_accepted", 4, STAGE.offer_accepted, "accept");
  push("offer_declined", 4, STAGE.offer_declined, "decline");

  const links: FunnelLink[] = [];
  for (const [key, count] of linkCount) {
    const [from, to] = key.split(">");
    links.push({ from, to, count });
  }
  return { nodes, links };
}
