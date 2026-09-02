import { describe, it, expect } from "vitest";
import { renderResumeLatex, escapeLatex, ResumeDoc } from "@/resume/latex";

const doc: ResumeDoc = {
  contact: { name: "Mengjia Shang", email: "m@example.com", phone: "+1-000", linkedin: "in/x", github: "gh/x" },
  sections: [
    {
      heading: "Education",
      entries: [{ title: "M.S. ECE", organization: "USC", location: "LA", dates: "2025–2027", bullets: ["Coursework: ML"] }],
    },
    {
      heading: "Experience",
      entries: [{ title: "SWE Intern", organization: "Acme & Co", location: "SF", dates: "2025", bullets: ["Built 50% faster pipeline", "Used C#"] }],
    },
    {
      heading: "Projects",
      entries: [{ title: "Distributed Trainer", organization: "PyTorch, CUDA", location: null, dates: "2025", bullets: ["Sharded training across 8 GPUs"] }],
    },
    {
      heading: "Technical Skills",
      entries: [
        { title: "Languages", organization: null, location: null, dates: null, bullets: ["Python", "C++", "Go"] },
        { title: "Frameworks", organization: null, location: null, dates: null, bullets: ["PyTorch", "React"] },
      ],
    },
  ],
};

describe("escapeLatex", () => {
  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("Acme & Co #1 50% $x_y")).toBe("Acme \\& Co \\#1 50\\% \\$x\\_y");
  });

  it("converts Greek letters and math operators the default text font can't render to \\ensuremath commands", () => {
    // tectonic/XeTeX's default text font (lmroman10-regular) has no glyph for these — left
    // as raw Unicode they compile "successfully" but render as missing-character boxes.
    expect(escapeLatex("swept β ∈ {0.05, 0.1}")).toBe("swept \\ensuremath{\\beta} \\ensuremath{\\in} \\{0.05, 0.1\\}");
    expect(escapeLatex("α, λ, μ, σ, θ tuning")).toBe(
      "\\ensuremath{\\alpha}, \\ensuremath{\\lambda}, \\ensuremath{\\mu}, \\ensuremath{\\sigma}, \\ensuremath{\\theta} tuning"
    );
    expect(escapeLatex("accuracy ≥ 95%, error ≤ 5%")).toBe(
      "accuracy \\ensuremath{\\geq} 95\\%, error \\ensuremath{\\leq} 5\\%"
    );
  });

  it("leaves already-renderable Unicode (arrows, en-dash, multiplication) untouched", () => {
    expect(escapeLatex("cut latency 800 ms → 350 ms, 3× faster")).toBe("cut latency 800 ms → 350 ms, 3× faster");
  });
});

describe("Jake's Resume renderer", () => {
  const tex = renderResumeLatex(doc);

  it("includes the Jake's Resume preamble markers", () => {
    expect(tex).toContain("\\documentclass[letterpaper,11pt]{article}");
    expect(tex).toContain("\\usepackage[empty]{fullpage}");
    expect(tex).toContain("\\input{glyphtounicode}");
    expect(tex).toContain("\\pdfgentounicode=1");
    expect(tex).toContain("\\sloppy");
    expect(tex).toContain("\\newcommand{\\resumeItem}");
    expect(tex).toContain("\\newcommand{\\resumeSubheading}");
    expect(tex).toContain("\\newcommand{\\resumeProjectHeading}");
    expect(tex).toContain("\\newcommand{\\resumeSubHeadingListStart}");
    expect(tex).toContain("\\newcommand{\\resumeItemListStart}");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
  });

  it("renders the header with name and contact line", () => {
    expect(tex).toContain("\\textbf{\\Huge \\scshape Mengjia Shang}");
    expect(tex).toContain("m@example.com");
    expect(tex).toContain("$|$");
  });

  it("renders education and experience via resumeSubheading", () => {
    expect(tex).toContain("\\resumeSubHeadingListStart");
    expect(tex).toContain("\\resumeSubHeadingListEnd");
    expect(tex).toMatch(/\\resumeSubheading\{M\.S\. ECE\}\{2025–2027\}\{USC\}\{LA\}/);
    expect(tex).toContain("\\resumeSubheading{SWE Intern}{2025}{Acme \\& Co}{SF}");
  });

  it("renders projects via resumeProjectHeading", () => {
    expect(tex).toContain("\\resumeProjectHeading{\\textbf{Distributed Trainer} $|$ \\emph{PyTorch, CUDA}}{2025}");
  });

  it("renders technical skills as a plain paragraph, not a subheading list", () => {
    const skillsIdx = tex.indexOf("\\section{Technical Skills}");
    expect(skillsIdx).toBeGreaterThan(-1);
    const skillsBlock = tex.slice(skillsIdx, skillsIdx + 400);
    expect(skillsBlock).not.toContain("\\resumeSubheading");
    expect(skillsBlock).toContain("\\textbf{Languages}");
    expect(skillsBlock).toContain("Python, C++, Go");
    expect(skillsBlock).toContain("\\textbf{Frameworks}");
  });

  it("defines resumeSubheading/resumeProjectHeading with a wrapping X column and the date pinned right on the first line", () => {
    // Root-cause regression lock: a fixed-width `tabular*` left cell does NOT wrap, so a long
    // title or "Title | tech-stack" project heading runs off the page (Overfull \hbox). A plain
    // minipage+\hfill wraps but lets a long left side push the DATE onto a second line. The
    // tabularx form keeps the date in its own right-aligned column on the first line while the
    // X column wraps; the @{\hspace{1em}} separator guarantees a visible gap so a wrapped
    // first line can never abut the date ("Beautiful2026 – Present").
    expect(tex).not.toContain("\\begin{tabular*}");
    expect(tex).not.toContain("\\begin{minipage}");
    const subheadingDef = tex.slice(tex.indexOf("\\newcommand{\\resumeSubheading}"), tex.indexOf("\\newcommand{\\resumeProjectHeading}"));
    expect(subheadingDef).toContain("\\begin{tabularx}{0.97\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}X@{\\hspace{1em}}r@{}}");
    const projectDef = tex.slice(tex.indexOf("\\newcommand{\\resumeProjectHeading}"), tex.indexOf("\\newcommand{\\resumeSubHeadingListStart}"));
    expect(projectDef).toContain("\\begin{tabularx}{0.97\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}X@{\\hspace{1em}}r@{}}");
  });

  it("applies escaping throughout", () => {
    expect(tex).toContain("Acme \\& Co");
    expect(tex).toContain("Built 50\\% faster pipeline");
  });

  it("omits empty sections", () => {
    const t = renderResumeLatex({ contact: doc.contact, sections: [{ heading: "Empty", entries: [] }] });
    expect(t).not.toContain("Empty");
  });

  it("treats an unknown section heading like experience (resumeSubheading default)", () => {
    const t = renderResumeLatex({
      contact: doc.contact,
      sections: [{ heading: "Leadership", entries: [{ title: "Club Lead", organization: "IEEE", location: "LA", dates: "2024", bullets: ["Ran weekly meetings"] }] }],
    });
    expect(t).toContain("\\section{Leadership}");
    expect(t).toContain("\\resumeSubheading{Club Lead}{2024}{IEEE}{LA}");
  });
});

import { linkParts } from "@/resume/latex";
describe("linkParts URL normalization", () => {
  it("handles a full https URL with trailing slash (no double scheme)", () => {
    const p = linkParts("https://www.linkedin.com/in/mengjia-shang-b5123029a/");
    expect(p.href).toBe("https://www.linkedin.com/in/mengjia-shang-b5123029a");
    expect(p.display).toBe("linkedin.com/in/mengjia-shang-b5123029a");
  });
  it("handles a bare host/path", () => {
    const p = linkParts("github.com/mokashang");
    expect(p.href).toBe("https://github.com/mokashang");
    expect(p.display).toBe("github.com/mokashang");
  });
});
