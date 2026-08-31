import { describe, it, expect } from "vitest";
import { visaFlag, type VisaFlag } from "@/scanner/visa-filter";

// Exhaustive fixtures accumulated across three rounds of review. Every JD-text probe the
// scanner's visa filter has ever needed to get right lives here, iterated with it.each so a
// future regression shows up as a single named failing case instead of a silent assertion
// buried inside a bigger it().
const MUST_FLAG: [string, VisaFlag][] = [
  // --- no_sponsor ---
  ["We are unable to sponsor visas for this role", "no_sponsor"],
  ["Will not sponsor employment visa now or in the future", "no_sponsor"],
  ["This position is not eligible for visa sponsorship", "no_sponsor"],
  ["We are not able to provide visa sponsorship", "no_sponsor"],
  ["We do not provide sponsorship for employment visas", "no_sponsor"],
  ["We do not offer visa sponsorship at this time", "no_sponsor"],
  ["This role is not eligible for employment visa sponsorship", "no_sponsor"],
  ["We are unable to provide sponsorship now or in the future", "no_sponsor"],
  ["Must be authorized to work in the U.S. without sponsorship", "no_sponsor"],
  [
    "Applicants must be U.S. citizens. We are unable to sponsor visas for this role.",
    "no_sponsor",
  ], // priority: no_sponsor beats citizen_only when both apply
  ["We do not currently sponsor employment visas.", "no_sponsor"],
  ["We are not sponsoring visas at this time.", "no_sponsor"],
  ["Sponsorship is not available for this position.", "no_sponsor"],
  ["Visa sponsorship is not offered for this role.", "no_sponsor"],
  ["Sponsorship is not provided.", "no_sponsor"],
  ["We will not be able to sponsor candidates for this role.", "no_sponsor"],
  ["No visa sponsorship.", "no_sponsor"],
  ["Sponsorship unavailable.", "no_sponsor"],
  ["We are not able to sponsor at this time.", "no_sponsor"],
  ["We are not able to sponsor candidates.", "no_sponsor"],
  ["Applicants are not eligible to sponsor.", "no_sponsor"],

  // --- citizen_only ---
  ["Applicants must be U.S. citizens", "citizen_only"],
  ["US Citizenship or Green Card required", "citizen_only"],

  // --- clearance ---
  ["Active TS/SCI security clearance required", "clearance"],
  ["Must be able to obtain a security clearance", "clearance"],
  ["Secret clearance required.", "clearance"],
  ["Top Secret clearance required.", "clearance"],
  ["Active Secret clearance required.", "clearance"],
  ["TS/SCI clearance required.", "clearance"],
  ["Requires an active TS/SCI with polygraph.", "clearance"],
  ["This position requires a current Top Secret clearance.", "clearance"],
];

const MUST_STAY_NULL: (string | null | undefined)[] = [
  "We welcome candidates of all backgrounds",
  "",
  "Visa sponsorship available",
  "Must be authorized to work in the US", // 模糊表述不误杀(用户策略:只跳过明确拒绝)
  null,
  undefined,
  "No security clearance is required",
  "This role does not require a security clearance",
  "Ability to obtain a security clearance is a plus",
  // Restored to include "security" — with bare "an active clearance" this passed for the
  // wrong reason (no clearance-type trigger word at all, so CLEARANCE never fired regardless
  // of the preference guard). With "security" present, only the preference-word lookbehind
  // keeps this null.
  "Preference given to candidates with an active security clearance.",
  "No prior experience required\n- We happily sponsor H-1B visas",
  "- No agencies please\n- We provide visa sponsorship",
  "Benefits include:\n- Unlimited PTO, no questions asked\n- Full visa sponsorship",
  "We are not just another startup - we sponsor visas and support green cards.",
  "We can sponsor visas for candidates who do not require immediate sponsorship.",
  "clearance not required",
  "Must have a strong background; clearance not required",
];

describe("visaFlag", () => {
  it.each(MUST_FLAG)("flags %#: %j as %s", (input, expected) => {
    expect(visaFlag(input)).toBe(expected);
  });

  it.each(MUST_STAY_NULL)("returns null for %#: %j", (input) => {
    expect(visaFlag(input)).toBeNull();
  });
});
