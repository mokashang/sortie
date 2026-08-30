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
