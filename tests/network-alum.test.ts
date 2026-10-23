import { describe, it, expect } from "vitest";
import { alumGuidance, isUscSchool } from "@/network/draft";

describe("alumni guidance follows the candidate's own school", () => {
  it("keeps the Trojan line for a USC candidate", () => {
    expect(isUscSchool("University of Southern California")).toBe(true);
    expect(isUscSchool("USC")).toBe(true);
    expect(alumGuidance("University of Southern California")).toMatch(/Trojan/);
  });

  it("names another school and never says Trojan for anyone else", () => {
    expect(isUscSchool("Peking University")).toBe(false);
    expect(isUscSchool("Muscatine Community College")).toBe(false); // "usc" inside a word is not USC
    const g = alumGuidance("Georgia Tech");
    expect(g).toMatch(/fellow alum of Georgia Tech/);
    expect(g).not.toMatch(/Trojan|USC|Fight on/);
  });
});
