import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { isInternalHref } from "@/app/lib/chat-markdown";
import { redactTokens } from "@/executor/runner";
import { upsertJobs } from "@/scanner/upsert";
import { removeUserFiles } from "@/lib/users";

// Smaller items from the 2026-10-22 security review.
describe("small security fixes", () => {
  it("a chat link to //host or /\\host is not treated as an in-app link", () => {
    expect(isInternalHref("/apply?tab=todo")).toBe(true);
    expect(isInternalHref("//evil.example")).toBe(false);
    expect(isInternalHref("/\\evil.example")).toBe(false);
  });
  it("tokens never survive into a run log line", () => {
    expect(redactTokens("curl -H 'authorization: Bearer sortie_internal_AbCdEfGhIjKlMnOpQrStUvWx12' http://127.0.0.1:3000")).toBe(
      "curl -H 'authorization: Bearer sortie_[redacted]' http://127.0.0.1:3000"
    );
    expect(redactTokens("sortie_ short words stay")).toBe("sortie_ short words stay");
  });
  it("a feed's non-http apply link is stored as no link, and never replaces a good one", () => {
    const db = openDb(":memory:");
    const base = { company: "Acme", title: "SWE", location: "Los Angeles, CA", source: "github_list", ats: null, postedAt: null } as const;
    upsertJobs(db, [{ ...base, jdText: "", applyUrl: "javascript:alert(1)" }]);
    expect((db.prepare("SELECT apply_url FROM jobs").get() as { apply_url: string | null }).apply_url).toBeNull();
    const db2 = openDb(":memory:");
    upsertJobs(db2, [{ ...base, jdText: "", applyUrl: "https://acme.example/jobs/1" }]);
    upsertJobs(db2, [{ ...base, jdText: "A real description of the role.", applyUrl: "data:text/html,x" }]);
    expect((db2.prepare("SELECT apply_url FROM jobs").get() as { apply_url: string | null }).apply_url).toBe("https://acme.example/jobs/1");
  });
  it("only a plain account id under data/users is ever removed", () => {
    expect(removeUserFiles("../..")).toBe(false);
    expect(removeUserFiles("legacy")).toBe(false);
    expect(removeUserFiles("no-such-user-dir-xyz")).toBe(false);
  });
});
