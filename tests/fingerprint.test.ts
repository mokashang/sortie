import { describe, it, expect } from "vitest";
import { fingerprint, dedupKey } from "@/scanner/fingerprint";
import { jdStatusFor } from "@/scanner/jd-status";

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

  it("collides accented and unaccented company names (NFKD diacritic strip)", () => {
    expect(fingerprint("Nestlé", "Data Scientist", "Vevey")).toBe(
      fingerprint("Nestle", "Data Scientist", "Vevey")
    );
  });

  it("does not collide different Japanese company names (widened unicode keep-class)", () => {
    expect(fingerprint("日本電気株式会社", "エンジニア", "東京")).not.toBe(
      fingerprint("株式会社日立製作所", "エンジニア", "東京")
    );
  });
});

describe("dedupKey", () => {
  it("normalizes company and title, ignores location, strips corp suffixes", () => {
    expect(dedupKey("Acme, Inc.", "Software Engineer Intern")).toBe("acme|software engineer intern");
    expect(dedupKey("ACME", "  Software   Engineer Intern ")).toBe("acme|software engineer intern");
  });
});

describe("jdStatusFor", () => {
  it("is 'missing' for empty or listing-metadata-only text, null for rich text", () => {
    expect(jdStatusFor("")).toBe("missing");
    expect(jdStatusFor(null)).toBe("missing");
    expect(jdStatusFor("[listing metadata] no visa sponsorship")).toBe("missing");
    expect(jdStatusFor("We are hiring a backend engineer.")).toBeNull();
  });
});
