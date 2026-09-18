// The tiny subset of Markdown the 问助手 answers use, parsed into blocks and inline spans the
// chat bubble renders itself (no HTML from the model ever reaches the DOM). Paragraphs, bullet
// and numbered lists, **bold**, `code`, and [links](/path) — internal paths become app links,
// anything else opens in a new tab. Pure, so it is unit-tested (tests/ui-chat-markdown.test.ts).

export type Span = { kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "code"; text: string } | { kind: "link"; text: string; href: string; internal: boolean };

export type Block = { kind: "p"; spans: Span[] } | { kind: "ul"; items: Span[][] } | { kind: "ol"; items: Span[][] };

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[2] !== undefined) out.push({ kind: "strong", text: m[2] });
    else if (m[4] !== undefined) out.push({ kind: "code", text: m[4] });
    else if (m[6] !== undefined && m[7] !== undefined) {
      const href = m[7];
      const safe = isInternalHref(href) || /^https?:\/\//i.test(href);
      if (safe) out.push({ kind: "link", text: m[6], href, internal: isInternalHref(href) });
      else out.push({ kind: "text", text: m[6] });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "p", spans: parseInline(para.join(" ")) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: list.kind, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const ul = line.match(UL);
    const ol = ul ? null : line.match(OL);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      const item = (ul ?? ol)![1];
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push(item);
      continue;
    }
    // A list item's continuation line (indented) belongs to the last item.
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    // Headings are flattened into bold paragraphs: the rules ask the model not to use them, but
    // a stray one should still read fine.
    const h = line.match(HEADING);
    para.push(h ? `**${h[1]}**` : line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
