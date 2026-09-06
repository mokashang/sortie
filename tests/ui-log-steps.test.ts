import { describe, it, expect } from "vitest";
import { parseLogLine, parseLog } from "@/app/lib/log-steps";

describe("log steps", () => {
  it("strips the timestamp prefix and classifies", () => {
    expect(parseLogLine("[14:34:31] 接单 apply run #25:计划 swe_general ×2")).toEqual({
      at: "14:34:31",
      text: "接单 apply run #25:计划 swe_general ×2",
      kind: "info",
    });
    expect(parseLogLine("[14:40:00] 已提交,看到成功页").kind).toBe("ok");
    expect(parseLogLine("[14:40:00] 等待用户确认(心跳)").kind).toBe("wait");
    expect(parseLogLine("[14:40:00] 跳过:明确不 sponsor,报 needs_manual").kind).toBe("warn");
    expect(parseLogLine("[14:40:00] 失败:页面打不开").kind).toBe("error");
    expect(parseLogLine("no prefix line")).toEqual({ at: null, text: "no prefix line", kind: "info" });
  });
  it("parseLog drops empty lines", () => {
    expect(parseLog(["[10:00:00] a", "", "b"]).map((s) => s.text)).toEqual(["a", "b"]);
  });
});
