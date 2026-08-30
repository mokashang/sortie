import { describe, it, expect } from "vitest";
import { fingerprint } from "@/scanner/fingerprint";

describe("fingerprint", () => {
  it("is stable across case/spacing/punctuation", () => {
    expect(fingerprint("Stripe, Inc.", "Software Engineer,  New Grad", "SF, CA")).toBe(
      fingerprint("stripe inc", "software engineer new grad", "sf ca")
    );
  });
  it("differs across companies", () => {
    expect(fingerprint("Stripe", "SWE", "SF")).not.toBe(fingerprint("Ramp", "SWE", "SF"));
  });
  it("tolerates missing location", () => {
    expect(fingerprint("A", "B", null)).toBe(fingerprint("A", "B", ""));
  });
});
