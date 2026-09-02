import { describe, it, expect } from "vitest";
import { buildApplyPrompt, buildNetworkSendPrompt, buildNetworkFindPrompt } from "@/executor/prompts";

describe("executor prompts", () => {
  describe("buildApplyPrompt", () => {
    it("interpolates the limit (default 5) and repeats it as the hard cap", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("最多投递 **5** 个申请");
      expect(p).toMatch(/硬上限 5 个申请/);
    });

    it("honors a custom limit", () => {
      const p = buildApplyPrompt({ limit: 12 });
      expect(p).toContain("最多投递 **12** 个申请");
      expect(p).toMatch(/硬上限 12 个申请/);
      expect(p).not.toContain("最多投递 **5** 个申请");
    });

    it("references the exact apply API endpoints", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("http://127.0.0.1:3000/api/apply/pending");
      expect(p).toContain("http://127.0.0.1:3000/api/apply/next");
      expect(p).toContain("http://127.0.0.1:3000/api/apply/report");
      expect(p).toContain('"http://127.0.0.1:3000/api/apply/pending?jobId=<jobId>"');
    });

    it("contains the browser MCP tool names, not claude-in-chrome tools", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("mcp__browser__browser_start");
      expect(p).toContain("mcp__browser__browser_status");
      expect(p).toContain("mcp__browser__browser_stop");
      expect(p).not.toContain("mcp__claude-in-chrome__");
      expect(p).not.toContain("tabs_create_mcp");
    });

    it("carries the submit red line verbatim in spirit", () => {
      const p = buildApplyPrompt();
      expect(p).toContain('decision: "approved"');
      expect(p).toMatch(/绝不点最终 Submit/);
      expect(p).toMatch(/绝不编造字段值/);
    });

    it("lists the needs_manual triggers and the error/needs_manual circuit breaker", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("already applied");
      expect(p).toContain("dead link");
      expect(p).toMatch(/连续 3 个 needs_manual 或连续 2 个 error/);
    });

    it("requires a live-page eligibility check before filling: PhD/no-sponsor/citizenship disqualifiers", () => {
      const p = buildApplyPrompt();
      expect(p).toMatch(/BEFORE filling anything/);
      expect(p).toMatch(/read the job description on this live page/);
      expect(p).toMatch(/a PhD is required and a Master'?s is not accepted/);
      expect(p).toMatch(/no visa sponsorship is provided\/available/);
      expect(p).toMatch(/US citizenship is required/);
      expect(p).toMatch(/do NOT fill the form/);
      expect(p).toContain('"status": "needs_manual", "reason": "<which disqualifier(s)');
      // Must stay lenient: "PhD preferred" / "MS or PhD" must NOT trigger this check.
      expect(p).toMatch(/"PhD preferred"、"MS or PhD"/);
    });

    describe("with a plan (per-direction quotas)", () => {
      const plan = [
        { direction: "swe_backend", count: 5 },
        { direction: "quant", count: 3 },
      ];

      it("lists each direction and its count, in the given order", () => {
        const p = buildApplyPrompt({ plan });
        const backendIdx = p.indexOf("swe_backend");
        const quantIdx = p.indexOf("quant");
        expect(backendIdx).toBeGreaterThan(-1);
        expect(quantIdx).toBeGreaterThan(-1);
        expect(backendIdx).toBeLessThan(quantIdx);
        expect(p).toMatch(/swe_backend.*\*\*5\*\*/);
        expect(p).toMatch(/quant.*\*\*3\*\*/);
      });

      it("shows the total (sum of quotas) as the session's hard cap", () => {
        const p = buildApplyPrompt({ plan });
        expect(p).toContain("硬性上限 **8**");
        expect(p).toMatch(/硬上限 8 个申请/);
      });

      it("shapes the /api/apply/next POST body with a direction field", () => {
        const p = buildApplyPrompt({ plan });
        expect(p).toContain(`${"http://127.0.0.1:3000/api/apply/next"}`);
        expect(p).toContain('{"direction": "<direction>"}');
        expect(p).toContain('{"direction": "swe_backend"}');
      });

      it("instructs moving to the next direction early on a per-direction done:true", () => {
        const p = buildApplyPrompt({ plan });
        expect(p).toMatch(/当前方向没有更多待投递岗位/);
        expect(p).toMatch(/换下一个方向/);
      });

      it("still carries the unchanged red lines and needs_manual triggers", () => {
        const p = buildApplyPrompt({ plan });
        expect(p).toContain('decision: "approved"');
        expect(p).toMatch(/绝不点最终 Submit/);
        expect(p).toContain("already applied");
        expect(p).toContain("dead link");
        expect(p).toMatch(/连续 3 个 needs_manual 或连续 2 个 error/);
      });
    });
  });

  describe("buildNetworkSendPrompt", () => {
    it("references the exact network send/report endpoints", () => {
      const p = buildNetworkSendPrompt();
      expect(p).toContain("http://127.0.0.1:3000/api/network/sendables");
      expect(p).toContain('http://127.0.0.1:3000/api/network/outreach?status=sent');
      expect(p).toContain("http://127.0.0.1:3000/api/network/report");
    });

    it("carries the session caps and pacing red lines", () => {
      const p = buildNetworkSendPrompt();
      expect(p).toMatch(/最多 10 个连接请求、最多 15 条消息/);
      expect(p).toMatch(/至少间隔 30 秒/);
      expect(p).toMatch(/channel === "linkedin"/);
    });

    it("carries the verbatim-check and double-send-guard red lines", () => {
      const p = buildNetworkSendPrompt();
      expect(p).toMatch(/逐字核对/);
      expect(p).toMatch(/双发/);
    });
  });

  describe("buildNetworkFindPrompt", () => {
    it("defaults to pulling companies from the queue endpoint", () => {
      const p = buildNetworkFindPrompt();
      expect(p).toContain('http://127.0.0.1:3000/api/queue?min=80');
    });

    it("interpolates explicit companies when given, in order", () => {
      const p = buildNetworkFindPrompt({ companies: ["Stripe", "Anthropic"] });
      expect(p).toContain("Stripe, Anthropic");
      expect(p).not.toContain('http://127.0.0.1:3000/api/queue?min=80');
    });

    it("is read-only: no Connect/Message red line", () => {
      const p = buildNetworkFindPrompt();
      expect(p).toMatch(/绝不点 Connect、绝不发消息/);
      expect(p).toContain("http://127.0.0.1:3000/api/network/people");
    });

    it("caps at 5 people per company and 3 companies per session", () => {
      const p = buildNetworkFindPrompt();
      expect(p).toMatch(/每公司最多 5 人,每会话最多 3 个公司/);
    });
  });
});
