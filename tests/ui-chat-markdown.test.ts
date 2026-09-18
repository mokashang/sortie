import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown, isInternalHref } from "@/app/lib/chat-markdown";

describe("chat markdown", () => {
  it("splits paragraphs and lists", () => {
    const blocks = parseMarkdown("Task #5 is running.\n\n- filled Stripe\n- waiting on Datadog\n\n1. open Apply\n2. press Confirm");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul", "ol"]);
    expect(blocks[1].kind === "ul" && blocks[1].items.length).toBe(2);
    expect(blocks[2].kind === "ol" && blocks[2].items[1][0]).toEqual({ kind: "text", text: "press Confirm" });
  });

  it("joins soft line breaks inside a paragraph and continuation lines inside an item", () => {
    const blocks = parseMarkdown("one\ntwo\n\n- item\n  continued");
    expect(blocks[0]).toEqual({ kind: "p", spans: [{ kind: "text", text: "one two" }] });
    expect(blocks[1].kind === "ul" && blocks[1].items[0]).toEqual([{ kind: "text", text: "item continued" }]);
  });

  it("parses bold, code and links; internal paths are app links, others open outside", () => {
    const spans = parseInline("Go to [Apply → To confirm](/apply?tab=confirm) and **press** `Confirm` or read [docs](https://example.com).");
    expect(spans).toEqual([
      { kind: "text", text: "Go to " },
      { kind: "link", text: "Apply → To confirm", href: "/apply?tab=confirm", internal: true },
      { kind: "text", text: " and " },
      { kind: "strong", text: "press" },
      { kind: "text", text: " " },
      { kind: "code", text: "Confirm" },
      { kind: "text", text: " or read " },
      { kind: "link", text: "docs", href: "https://example.com", internal: false },
      { kind: "text", text: "." },
    ]);
  });

  it("drops unsafe link schemes but keeps their text", () => {
    expect(parseInline("[x](javascript:void)")).toEqual([{ kind: "text", text: "x" }]);
    expect(parseInline("[y](data:text/html;base64,AAAA)")).toEqual([{ kind: "text", text: "y" }]);
    expect(isInternalHref("/queue")).toBe(true);
    expect(isInternalHref("//evil.example")).toBe(false);
  });

  it("flattens a stray heading into a bold paragraph", () => {
    expect(parseMarkdown("## Status\nfine")).toEqual([{ kind: "p", spans: [{ kind: "strong", text: "Status" }, { kind: "text", text: " fine" }] }]);
  });
});
