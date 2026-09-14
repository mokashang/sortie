"use client";
import { useMemo } from "react";
import { buildFunnel, FunnelKind, FunnelNode } from "@/apply/funnel";
import type { HistoryRow } from "@/apply/stages";
import { Section } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

// 投递漏斗 — a hand-laid Sankey of the post-submit pipeline. Layout is a fixed five-column tree
// (every node has exactly one parent), so no d3-sankey: columns are equally spaced, each column
// stacks its nodes top-down in advance / wait / drop order, band thickness is proportional to the
// row count, and each link is a cubic band from its parent's running out-offset to the child's
// top. Colors are CSS variables so the chart follows the 制版间 light/dark palette.

const W = 960;
const PAD_X = 110; // room for the root label on the left and the leaf labels on the right
const PAD_TOP = 24;
const PAD_BOTTOM = 16;
const NODE_W = 14;
const GAP = 38; // vertical gap between stacked nodes — enough for a two-line label
const MIN_H = 3;
const TARGET_H = 320;

const FILL: Record<FunnelKind | "root" | "offer", string> = {
  root: "var(--sub)",
  stage: "var(--good)",
  offer: "var(--warn)",
  accept: "var(--warn)",
  decline: "var(--sub)",
  drop: "var(--accent)",
  wait: "var(--line)",
};

function fillOf(n: FunnelNode): string {
  if (n.id === "submitted") return FILL.root;
  if (n.id === "offer") return FILL.offer;
  return FILL[n.kind];
}

const ORDER: Record<FunnelKind, number> = { stage: 0, accept: 0, wait: 1, decline: 2, drop: 3 };

interface Placed extends FunnelNode {
  x: number;
  y: number;
  h: number;
}

export function HistorySankey({ rows }: { rows: HistoryRow[] }) {
  const m = useMessages();
  const lang = useLang();
  const layout = useMemo(() => {
    const { nodes, links } = buildFunnel(rows, lang);
    if (nodes.length === 0) return null;
    const total = rows.length;
    const maxStack = Math.max(...[0, 1, 2, 3, 4].map((l) => nodes.filter((n) => n.layer === l).length));
    // Cap the per-row thickness so a handful of applications draws as a slim flow, not a slab.
    const scale = Math.min(28, (TARGET_H - PAD_TOP - PAD_BOTTOM - GAP * (maxStack - 1)) / total);
    const colX = (layer: number) => PAD_X + ((W - 2 * PAD_X - NODE_W) * layer) / 4;

    const placed = new Map<string, Placed>();
    let height = 0;
    for (let layer = 0; layer <= 4; layer++) {
      const col = nodes.filter((n) => n.layer === layer).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      let y = PAD_TOP;
      for (const n of col) {
        const h = Math.max(MIN_H, n.count * scale);
        placed.set(n.id, { ...n, x: colX(layer), y, h });
        y += h + GAP;
      }
      height = Math.max(height, y - GAP + PAD_BOTTOM);
    }

    // Bands: a parent's outgoing links leave in the vertical order of their targets so bands
    // don't cross; every child has a single incoming band, which starts at its top.
    const outOffset = new Map<string, number>();
    const bands = [...links]
      .sort((a, b) => placed.get(a.to)!.y - placed.get(b.to)!.y)
      .map((l) => {
        const from = placed.get(l.from)!;
        const to = placed.get(l.to)!;
        const t = Math.max(MIN_H, l.count * scale);
        const y0 = from.y + (outOffset.get(l.from) ?? 0);
        outOffset.set(l.from, (outOffset.get(l.from) ?? 0) + t);
        const y1 = to.y;
        const x0 = from.x + NODE_W;
        const x1 = to.x;
        const xm = (x0 + x1) / 2;
        const d =
          `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} ` +
          `L${x1},${y1 + t} C${xm},${y1 + t} ${xm},${y0 + t} ${x0},${y0 + t} Z`;
        return { key: `${l.from}>${l.to}`, d, fill: fillOf(to), count: l.count, from, to };
      });

    return { nodes: [...placed.values()], bands, height, total };
  }, [rows, lang]);

  if (!layout) return null;

  return (
    <Section title={m.history.funnel.title} count={layout.total}>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${layout.height}`}
          width="100%"
          style={{ maxWidth: W, display: "block", fontFamily: "var(--font-sans)" }}
          role="img"
          aria-label={m.history.funnel.chartLabel}
        >
          {layout.bands.map((b) => (
            <path key={b.key} d={b.d} fill={b.fill} opacity={0.32}>
              <title>{m.history.funnel.flow(b.from.label, b.to.label, b.count)}</title>
            </path>
          ))}
          {layout.nodes.map((n) => {
            const isRoot = n.layer === 0;
            const tx = isRoot ? n.x - 10 : n.x + NODE_W + 10;
            const anchor = isRoot ? "end" : "start";
            const ty = n.y + Math.min(n.h / 2, 12);
            return (
              <g key={n.id}>
                <rect x={n.x} y={n.y} width={NODE_W} height={n.h} fill={fillOf(n)} rx={1}>
                  <title>{m.history.funnel.node(n.label, n.count)}</title>
                </rect>
                <text x={tx} y={ty} textAnchor={anchor} fill="var(--ink)" fontSize={17} fontWeight={700} fontFamily="var(--font-mono)">
                  {n.count}
                </text>
                <text x={tx} y={ty + 16} textAnchor={anchor} fill="var(--sub)" fontSize={12}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Section>
  );
}
