import { describe, it, expect } from "vitest";
import { extractJson } from "@/llm/extract";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("strips bare ``` fences", () => {
    expect(extractJson('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });
  it("finds the first JSON value amid prose", () => {
    expect(extractJson('Sure! Here you go:\n{"x": true}\nHope that helps')).toEqual({ x: true });
  });
  it("parses a top-level array with surrounding text", () => {
    expect(extractJson('Result: [{"id":1},{"id":2}] done')).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it("throws a clear error when no JSON present", () => {
    expect(() => extractJson("no json here")).toThrow(/no json/i);
  });
  it("retries past a stray leading bracket to find the real JSON value", () => {
    expect(extractJson('Here is the result {see note}: [{"job_id":1}]')).toEqual([{ job_id: 1 }]);
    expect(extractJson('Options [A/B]: {"pick":"A"}')).toEqual({ pick: "A" });
  });
  it("tolerates trailing commas via a lenient fallback parse", () => {
    expect(extractJson('```json\n{"a":1,}\n```')).toEqual({ a: 1 });
    expect(extractJson('[1,2,3,]')).toEqual([1, 2, 3]);
  });
});
