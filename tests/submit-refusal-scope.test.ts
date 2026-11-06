import { describe, it, expect } from "vitest";
import { approvedNotice, IF_SUBMIT_REFUSED } from "@/executor/attended-session";

describe("a refused Submit", () => {
  it("covers that one job: the rest of the approved forms still get their click", () => {
    expect(IF_SUBMIT_REFUSED).toMatch(/covers that one job only/);
    expect(IF_SUBMIT_REFUSED).toMatch(/never report submit_blocked for a job you did not click/);
    expect(approvedNotice(1, "Acme")).toContain(IF_SUBMIT_REFUSED);
  });

  it("still forbids clicking the refused job again or going around the check", () => {
    expect(IF_SUBMIT_REFUSED).toMatch(/do not retry it and do not try another way/);
  });
});
