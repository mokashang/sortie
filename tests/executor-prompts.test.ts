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

    it("contains the playwright MCP tool names, not hanzi or claude-in-chrome tools", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("mcp__playwright__browser_navigate");
      expect(p).toContain("mcp__playwright__browser_snapshot");
      expect(p).toContain("mcp__playwright__browser_click");
      expect(p).toContain("mcp__playwright__browser_type");
      expect(p).toContain("mcp__playwright__browser_file_upload");
      expect(p).toContain("mcp__playwright__browser_tabs");
      expect(p).not.toContain("mcp__browser__");
      expect(p.toLowerCase()).not.toContain("hanzi");
      expect(p).not.toContain("mcp__claude-in-chrome__");
      expect(p).not.toContain("tabs_create_mcp");
    });

    it("requires re-verifying the form for drift after approval, before the final submit click", () => {
      const p = buildApplyPrompt();
      expect(p).toMatch(/批准可能是 30 分钟之后才来的/);
      expect(p).toMatch(/字段漂移/);
      expect(p).toMatch(/不要提交/);
    });

    it("reports needs_manual with the login-wall reason when the profile isn't logged in", () => {
      const p = buildApplyPrompt();
      expect(p).toContain("login required in browser profile — 请在设置里打开浏览器档案登录一次");
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
        expect(p).toContain('{"direction": "<direction>", "mode": "direct"}');
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

    describe("Greenhouse fill heuristics", () => {
      it("are present in the default (non-resume) prompt", () => {
        const p = buildApplyPrompt();
        expect(p).toMatch(/react-select/);
        expect(p).toMatch(/EXACT visible text|完全一致的可见文字/);
        expect(p).toMatch(/Vanguard University of Southern California/);
        expect(p).toMatch(/checkbox/);
        expect(p).toMatch(/标签文字/);
        expect(p).toMatch(/Country/);
        expect(p).toMatch(/Electrical Engineering/);
        expect(p).toMatch(/Computer Science/);
        expect(p).toMatch(/Simplify/);
        expect(p).toMatch(/Autofill/);
        expect(p).toMatch(/read-back|读回/);
      });

      it("are also present with a plan", () => {
        const p = buildApplyPrompt({ plan: [{ direction: "swe_backend", count: 2 }] });
        expect(p).toMatch(/react-select/);
        expect(p).toMatch(/Simplify/);
      });
    });

    describe("resume mode", () => {
      it("without resume, the prompt has no §0 resume phase", () => {
        const p = buildApplyPrompt();
        expect(p).not.toMatch(/恢复模式/);
        expect(p).not.toContain("/api/apply/task");
      });

      it("resume with no plan/limit produces a resume-only prompt: fetches pending, filters approved, re-fills via /api/apply/task, and does not enter the normal /api/apply/next loop", () => {
        const p = buildApplyPrompt({ resume: true });
        expect(p).toMatch(/恢复模式/);
        expect(p).toContain("http://127.0.0.1:3000/api/apply/pending");
        expect(p).toContain('decision === "approved"');
        expect(p).toContain("http://127.0.0.1:3000/api/apply/task?jobId=");
        expect(p).not.toContain("http://127.0.0.1:3000/api/apply/next");
        expect(p).toMatch(/不要调用 \/api\/apply\/next/);
      });

      it("resume with no plan/limit still carries the submit red line and the awaiting_confirm reset explanation", () => {
        const p = buildApplyPrompt({ resume: true });
        expect(p).toMatch(/"approved"` → 进入第 6 步/);
        expect(p).toMatch(/重置为 null/);
        expect(p).toMatch(/这是故意的/);
      });

      it("resume with no plan/limit still carries the Greenhouse heuristics", () => {
        const p = buildApplyPrompt({ resume: true });
        expect(p).toMatch(/react-select/);
        expect(p).toMatch(/Simplify/);
      });

      it("resume + plan does both: the resume phase AND the normal plan-mode main loop", () => {
        const p = buildApplyPrompt({ resume: true, plan: [{ direction: "swe_backend", count: 3 }] });
        expect(p).toMatch(/恢复模式/);
        expect(p).toContain("http://127.0.0.1:3000/api/apply/task?jobId=");
        // Falls through into the normal main loop content, unlike the resume-only case.
        expect(p).toContain("http://127.0.0.1:3000/api/apply/next");
        expect(p).toMatch(/继续进入下面 §1 的 Preflight 和常规循环/);
        expect(p).toMatch(/swe_backend.*\*\*3\*\*/);
      });

      it("resume + explicit limit (no plan) also falls through into the normal main loop", () => {
        const p = buildApplyPrompt({ resume: true, limit: 7 });
        expect(p).toMatch(/恢复模式/);
        expect(p).toContain("http://127.0.0.1:3000/api/apply/next");
        expect(p).toMatch(/继续进入下面 §1 的 Preflight 和常规循环/);
        expect(p).toMatch(/最多投递 \*\*7\*\* 个申请/);
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

describe("buildApplyPrompt direct-only plan", () => {
  it("headless apply prompt with a mixed plan lists entries and takes tasks with mode direct", () => {
    const p = buildApplyPrompt({ plan: [{ direction: "swe_general", count: 2, mode: "direct" }, { direction: "mle", count: 1 }] });
    expect(p).toContain("`swe_general` × **2**");
    expect(p).toContain("`mle` × **1**");
    expect(p).toContain('"mode": "direct"');
  });
});
