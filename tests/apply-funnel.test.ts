import { describe, it, expect } from "vitest";
import { buildFunnel } from "@/apply/funnel";
import type { PostSubmitStage, PeakStage } from "@/apply/stages";

function row(status: PostSubmitStage, peak: PeakStage) {
  return { status, peak };
}

function count(f: ReturnType<typeof buildFunnel>, id: string): number {
  return f.nodes.find((n) => n.id === id)?.count ?? 0;
}
function link(f: ReturnType<typeof buildFunnel>, from: string, to: string): number {
  return f.links.find((l) => l.from === from && l.to === to)?.count ?? 0;
}

describe("buildFunnel (sankey data for /history)", () => {
  it("routes every row through the layers it reached and lands it in its current bucket", () => {
    const f = buildFunnel([
      row("submitted", "submitted"), // waiting at layer 1
      row("submitted", "submitted"),
      row("rejected", "submitted"), // dropped without any reply
      row("stale", "submitted"),
      row("oa", "oa"), // OA in progress
      row("rejected", "oa"), // dropped after OA
      row("interview", "interview"), // interviewing
      row("stale", "interview"), // dropped after interview
      row("offer", "offer"), // offer pending
      row("offer_accepted", "offer"),
      row("offer_declined", "offer"),
    ]);

    expect(count(f, "submitted")).toBe(11);
    expect(count(f, "wait_submitted")).toBe(2);
    expect(count(f, "drop_submitted")).toBe(2);
    expect(count(f, "oa")).toBe(7);
    expect(count(f, "drop_oa")).toBe(1);
    expect(count(f, "interview")).toBe(5);
    expect(count(f, "drop_interview")).toBe(1);
    expect(count(f, "offer")).toBe(3);
    expect(count(f, "offer_accepted")).toBe(1);
    expect(count(f, "offer_declined")).toBe(1);
    // In-progress OA / interview / pending offer rows stay inside their stage node — there is no
    // "waiting" branch past the first layer.
    expect(f.nodes.find((n) => n.id === "wait_oa")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "wait_interview")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "wait_offer")).toBeUndefined();

    expect(link(f, "submitted", "oa")).toBe(7);
    expect(link(f, "submitted", "drop_submitted")).toBe(2);
    expect(link(f, "submitted", "wait_submitted")).toBe(2);
    expect(link(f, "oa", "interview")).toBe(5);
    expect(link(f, "interview", "offer")).toBe(3);
    expect(link(f, "offer", "offer_accepted")).toBe(1);
    expect(link(f, "offer", "offer_declined")).toBe(1);
    expect(f.links.filter((l) => l.from === "offer").reduce((s, l) => s + l.count, 0)).toBe(2);
  });

  it("conserves inflow: what enters a stage node equals its count; outflow may be smaller (rows still in progress)", () => {
    const f = buildFunnel([
      row("submitted", "submitted"),
      row("rejected", "submitted"),
      row("oa", "oa"),
      row("interview", "interview"),
      row("rejected", "interview"),
      row("offer", "offer"),
      row("offer_accepted", "offer"),
    ]);
    for (const id of ["oa", "interview", "offer"]) {
      const inflow = f.links.filter((l) => l.to === id).reduce((s, l) => s + l.count, 0);
      const outflow = f.links.filter((l) => l.from === id).reduce((s, l) => s + l.count, 0);
      expect(inflow).toBe(count(f, id));
      expect(outflow).toBeLessThanOrEqual(count(f, id));
    }
    // oa: 5 in, 1 still in OA stays, 4 on to interview; interview: 4 in, 1 interviewing stays,
    // 1 rejected + 2 to offer leave; offer: 2 in, 1 pending stays, 1 accepted leaves
    expect(f.links.filter((l) => l.from === "oa").reduce((s, l) => s + l.count, 0)).toBe(4);
    expect(f.links.filter((l) => l.from === "interview").reduce((s, l) => s + l.count, 0)).toBe(3);
    expect(f.links.filter((l) => l.from === "offer").reduce((s, l) => s + l.count, 0)).toBe(1);
    const rootOut = f.links.filter((l) => l.from === "submitted").reduce((s, l) => s + l.count, 0);
    expect(rootOut).toBe(7);
  });

  it("omits empty nodes and links and assigns layers left to right", () => {
    const f = buildFunnel([row("submitted", "submitted"), row("rejected", "submitted")]);
    expect(f.nodes.map((n) => n.id).sort()).toEqual(["drop_submitted", "submitted", "wait_submitted"]);
    expect(f.links).toHaveLength(2);
    expect(f.nodes.find((n) => n.id === "submitted")?.layer).toBe(0);
    expect(f.nodes.find((n) => n.id === "drop_submitted")?.layer).toBe(1);
    expect(f.nodes.every((n) => typeof n.label === "string" && n.label.length > 0)).toBe(true);
  });

  it("returns nothing for no rows", () => {
    expect(buildFunnel([])).toEqual({ nodes: [], links: [] });
  });
});
