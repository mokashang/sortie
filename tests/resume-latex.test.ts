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
  ],
};

describe("latex renderer", () => {
  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("Acme & Co #1 50% $x_y")).toBe("Acme \\& Co \\#1 50\\% \\$x\\_y");
  });
  it("renders a compilable-looking document with all content", () => {
    const tex = renderResumeLatex(doc);
    expect(tex).toContain("\\documentclass");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
    expect(tex).toContain("Mengjia Shang");
    expect(tex).toContain("Acme \\& Co"); // escaped
    expect(tex).toContain("Built 50\\% faster pipeline"); // escaped
    expect(tex).toContain("Education");
    expect(tex).toContain("SWE Intern");
  });
  it("omits empty sections", () => {
    const tex = renderResumeLatex({ contact: doc.contact, sections: [{ heading: "Empty", entries: [] }] });
    expect(tex).not.toContain("Empty");
  });
});
