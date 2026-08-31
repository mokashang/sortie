export interface ResumeContact {
  name: string; email: string; phone: string; linkedin: string; github: string;
}
export interface ResumeEntry {
  title: string; organization?: string | null; location?: string | null; dates?: string | null; bullets: string[];
}
export interface ResumeSection {
  heading: string; entries: ResumeEntry[];
}
export interface ResumeDoc {
  contact: ResumeContact; sections: ResumeSection[];
}

// LaTeX special chars → escaped. Order matters: backslash first.
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

// Self-contained article-class resume. Kept deliberately simple so tectonic compiles it
// with zero external packages beyond the standard set.
export function renderResumeLatex(doc: ResumeDoc): string {
  const c = doc.contact;
  const header =
    `\\documentclass[10pt,letterpaper]{article}\n` +
    `\\usepackage[margin=0.5in]{geometry}\n` +
    `\\usepackage{enumitem}\n` +
    `\\usepackage[hidelinks]{hyperref}\n` +
    `\\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=2pt}\n` +
    `\\pagestyle{empty}\n` +
    `\\begin{document}\n`;

  const contactBlock =
    `\\begin{center}\n` +
    `{\\Large \\textbf{${escapeLatex(c.name)}}}\\\\[2pt]\n` +
    `${escapeLatex(c.email)} $\\cdot$ ${escapeLatex(c.phone)} $\\cdot$ ${escapeLatex(c.linkedin)} $\\cdot$ ${escapeLatex(c.github)}\n` +
    `\\end{center}\n`;

  const body = doc.sections
    .filter((s) => s.entries.length > 0)
    .map((s) => {
      const entries = s.entries
        .map((e) => {
          const line1parts = [`\\textbf{${escapeLatex(e.title)}}`];
          if (e.organization) line1parts.push(escapeLatex(e.organization));
          const left = line1parts.join(", ");
          const right = [e.location, e.dates].filter(Boolean).map((x) => escapeLatex(x as string)).join(" $\\cdot$ ");
          const heading = right ? `${left} \\hfill ${right}\\\\` : `${left}\\\\`;
          const bullets = e.bullets.length
            ? `\\begin{itemize}\n${e.bullets.map((b) => `  \\item ${escapeLatex(b)}`).join("\n")}\n\\end{itemize}\n`
            : "";
          return `${heading}\n${bullets}`;
        })
        .join("\n\\vspace{2pt}\n");
      return `\\section*{${escapeLatex(s.heading)}}\n\\hrule\\vspace{4pt}\n${entries}`;
    })
    .join("\n\n");

  return `${header}${contactBlock}\n${body}\n\\end{document}\n`;
}
