import { describe, it, expect } from "vitest";
import { locFlag, type LocFlag } from "@/scanner/location-filter";

// Mirrors visa-filter.test.ts's philosophy and structure exactly (spec: US-only location hard
// filter must fail open on anything ambiguous — only clearly-foreign locations get flagged).
const MUST_FLAG: [string, LocFlag][] = [
  ["London, UK", "non_us"],
  ["London", "non_us"],
  ["Toronto, ON, Canada", "non_us"],
  ["Singapore", "non_us"],
  ["Montreal, QC, Canada", "non_us"],
  ["Belgrade", "non_us"],
  ["Bangalore, India", "non_us"],
  ["Tokyo, Japan", "non_us"],
  ["Remote - Canada", "non_us"],
  ["Dublin, Ireland", "non_us"],
  ["Warsaw, Poland", "non_us"],
  ["Hong Kong", "non_us"],
  // "Cambridge" and "Irvine" are both real US cities (Cambridge, MA; Irvine, CA) whitelisted
  // below, AND real foreign ones (Cambridge, UK; Irvine, Scotland) — an explicit ", UK" /
  // "United Kingdom" qualifier right after the name must still flag these as clearly foreign,
  // not get swallowed by the US whitelist collision.
  ["Cambridge, UK", "non_us"],
  ["Irvine, UK", "non_us"],
];

const MUST_KEEP: (string | null | undefined)[] = [
  "San Francisco",
  "SF",
  "NYC",
  "New York, NY (HQ)",
  "Seattle, WA",
  "Remote",
  "Remote in USA",
  "United States",
  null,
  "",
  "San Jose, CA",
  "Washington, D.C.",
  "New York; London", // multi-location rule: any US signal wins even with a foreign city present
  "US - Remote",
  "Cambridge, MA",
  "Flexible / Remote",
  "Irvine, CA",
];

describe("locFlag", () => {
  it.each(MUST_FLAG)("flags %#: %j as %s", (input, expected) => {
    expect(locFlag(input)).toBe(expected);
  });

  it.each(MUST_KEEP)("returns null for %#: %j", (input) => {
    expect(locFlag(input)).toBeNull();
  });
});
