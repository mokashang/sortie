import { describe, it, expect } from "vitest";
import { parseMatchArgs } from "../scripts/match";

describe("parseMatchArgs", () => {
  it("defaults to no limit, rescoreArchived false, concurrency 6", () => {
    expect(parseMatchArgs([])).toEqual({ limit: undefined, rescoreArchived: false, concurrency: 6, rescoreMatched: false });
  });

  it("parses --concurrency N", () => {
    expect(parseMatchArgs(["--concurrency", "3"])).toEqual({ limit: undefined, rescoreArchived: false, concurrency: 3, rescoreMatched: false });
  });

  it("parses --concurrency alongside limit and --rescore-archived, in any order", () => {
    expect(parseMatchArgs(["20", "--concurrency", "4", "--rescore-archived"])).toEqual({
      limit: 20,
      rescoreArchived: true,
      concurrency: 4,
      rescoreMatched: false,
    });
    expect(parseMatchArgs(["--concurrency", "4", "--rescore-archived", "20"])).toEqual({
      limit: 20,
      rescoreArchived: true,
      concurrency: 4,
      rescoreMatched: false,
    });
  });

  it("parses a bare numeric arg as the limit", () => {
    expect(parseMatchArgs(["20"])).toEqual({ limit: 20, rescoreArchived: false, concurrency: 6, rescoreMatched: false });
  });

  it("parses --rescore-archived as a flag", () => {
    expect(parseMatchArgs(["--rescore-archived"])).toEqual({ limit: undefined, rescoreArchived: true, concurrency: 6, rescoreMatched: false });
  });

  it("parses limit and flag together, in either order", () => {
    expect(parseMatchArgs(["20", "--rescore-archived"])).toEqual({ limit: 20, rescoreArchived: true, concurrency: 6, rescoreMatched: false });
    expect(parseMatchArgs(["--rescore-archived", "20"])).toEqual({ limit: 20, rescoreArchived: true, concurrency: 6, rescoreMatched: false });
  });

  it("ignores non-numeric junk args rather than throwing", () => {
    expect(parseMatchArgs(["--help-nonexistent", "0"])).toEqual({ limit: 0, rescoreArchived: false, concurrency: 6, rescoreMatched: false });
  });

  it("parses --rescore-matched", () => {
    expect(parseMatchArgs(["--rescore-matched", "--concurrency", "4"])).toMatchObject({ rescoreMatched: true, concurrency: 4 });
  });
});
