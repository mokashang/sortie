import { describe, it, expect } from "vitest";
import { runStatusDisplay, runProgressText, runBreakdownText, RunOutcome } from "@/app/lib/run-outcome";

function outcome(over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    planned: { direct: 70, referral: 40 },
    achieved: { direct: 5, referral: 0 },
    own: { direct: 5, referral: 0 },
    submitted: 5,
    awaiting: 0,
    manual: 3,
    archived: 2,
    info: 1,
    complete: false,
    ...over,
  };
}

describe("run outcome display", () => {
  it("a normally ended run that fell short of its plan is 未完成, not 已完成", () => {
    expect(runStatusDisplay("done", outcome(), "zh")).toEqual({ label: "未完成", tone: "warn" });
  });

  it("已完成 only when the plan was met, or when there was no plan to measure against", () => {
    expect(runStatusDisplay("done", outcome({ achieved: { direct: 70, referral: 40 }, complete: true }), "zh")).toEqual({
      label: "已完成",
      tone: "good",
    });
    expect(runStatusDisplay("done", null, "zh")).toEqual({ label: "已完成", tone: "good" });
    expect(runStatusDisplay("done", null, "zh")).toEqual({ label: "已完成", tone: "good" });
  });

  it("failed / stopped / paused / live runs keep their own labels regardless of the outcome", () => {
    expect(runStatusDisplay("failed", outcome(), "zh")).toEqual({ label: "失败", tone: "danger" });
    expect(runStatusDisplay("stopped", outcome(), "zh")).toEqual({ label: "已停止", tone: "neutral" });
    expect(runStatusDisplay("paused", null, "zh")).toEqual({ label: "已暂停", tone: "warn" });
    expect(runStatusDisplay("running", null, "zh")).toEqual({ label: "进行中", tone: "accent" });
    expect(runStatusDisplay("queued", null, "zh")).toEqual({ label: "排队中", tone: "info" });
  });

  it("progress text shows achieved/planned per mode the plan asked for, plus this segment's share for a chained run", () => {
    expect(runProgressText(outcome(), "zh")).toBe("海投 5/70 · 内推 0/40");
    expect(runProgressText(outcome({ planned: { direct: 3, referral: 0 }, achieved: { direct: 3, referral: 0 } }), "zh")).toBe("海投 3/3");
    expect(runProgressText(outcome({ planned: { direct: 0, referral: 2 }, achieved: { direct: 0, referral: 1 } }), "zh")).toBe("内推 1/2");
    expect(
      runProgressText(outcome({ achieved: { direct: 15, referral: 0 }, own: { direct: 10, referral: 0 }, chain: { root: 68, step: 2 } }), "zh")
    ).toBe("海投 15/70 · 内推 0/40 · 本段 10");
    expect(runProgressText(null, "zh")).toBe("");
    expect(runProgressText(undefined, "zh")).toBe("");
  });

  it("breakdown text lists the non-zero buckets only", () => {
    expect(runBreakdownText(outcome(), "zh")).toBe("提交 5 · 待处理 1 · 归档 2 · 找不到人 3");
    expect(runBreakdownText(outcome({ submitted: 0, awaiting: 2, manual: 0, archived: 0, info: 0 }), "zh")).toBe("待确认 2");
    expect(runBreakdownText(outcome({ submitted: 0, awaiting: 0, manual: 0, archived: 0, info: 0 }), "zh")).toBe("");
    expect(runBreakdownText(null, "zh")).toBe("");
  });
});

describe("chain end text", () => {
  const base: RunOutcome = {
    planned: { direct: 90, referral: 0 },
    achieved: { direct: 63, referral: 0 },
    own: { direct: 0, referral: 0 },
    submitted: 0,
    awaiting: 0,
    manual: 0,
    archived: 3,
    info: 1,
    complete: false,
    chain: { root: 118, step: 9 },
  };
  it("says why the plan stopped short, naming the directions given up on", () => {
    const o = { ...base, end: { reason: "exhausted" as const, dropped: [{ direction: "embedded", count: 17, mode: "direct" as const }] } };
    expect(runProgressText(o, "zh")).toBe("海投 63/90 · 本段 0 · 剩余方向无可投岗(Embedded / Firmware 17)");
    expect(runProgressText(o, "en")).toBe("direct 63/90 · this segment 0 · remaining directions ran dry (Embedded / Firmware 17)");
    expect(runProgressText({ ...base, end: { reason: "no_progress" } }, "zh")).toBe("海投 63/90 · 本段 0 · 连续两段无进展,已停止");
    expect(runProgressText({ ...base, end: { reason: "too_long" } }, "en")).toBe("direct 63/90 · this segment 0 · stopped: relay segment limit reached");
  });
  it("stays silent while the chain goes on, when the plan was met, and for a referral entry it labels the mode", () => {
    expect(runProgressText(base, "zh")).toBe("海投 63/90 · 本段 0");
    expect(runProgressText({ ...base, achieved: { direct: 90, referral: 0 }, complete: true, end: { reason: "done" } }, "zh")).toBe("海投 90/90 · 本段 0");
    const o = { ...base, planned: { direct: 0, referral: 5 }, achieved: { direct: 0, referral: 2 }, end: { reason: "exhausted" as const, dropped: [{ direction: "swe_general", count: 3, mode: "referral" as const }] } };
    expect(runProgressText(o, "zh")).toBe("内推 2/5 · 本段 0 · 剩余方向无可投岗(SWE (General) · 内推 3)");
  });
});
