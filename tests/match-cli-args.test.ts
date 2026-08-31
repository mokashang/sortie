import { describe, it, expect } from "vitest";
import { parseMatchArgs } from "../scripts/match";

describe("parseMatchArgs", () => {
  it("defaults to no limit and rescoreArchived false", () => {
    expect(parseMatchArgs([])).toEqual({ limit: undefined, rescoreArchived: false });
  });

  it("parses a bare numeric arg as the limit", () => {
    expect(parseMatchArgs(["20"])).toEqual({ limit: 20, rescoreArchived: false });
  });

  it("parses --rescore-archived as a flag", () => {
    expect(parseMatchArgs(["--rescore-archived"])).toEqual({ limit: undefined, rescoreArchived: true });
  });

  it("parses limit and flag together, in either order", () => {
    expect(parseMatchArgs(["20", "--rescore-archived"])).toEqual({ limit: 20, rescoreArchived: true });
    expect(parseMatchArgs(["--rescore-archived", "20"])).toEqual({ limit: 20, rescoreArchived: true });
  });

  it("ignores non-numeric junk args rather than throwing", () => {
    expect(parseMatchArgs(["--help-nonexistent", "0"])).toEqual({ limit: 0, rescoreArchived: false });
  });
});
