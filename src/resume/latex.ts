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

// Greek letters and math operators that LLM-generated bullet text sometimes contains (e.g.
// "swept β ∈ {0.05, 0.1}") but that tectonic's default text font (lmroman10-regular) has no
// glyph for — left as raw Unicode they compile "successfully" yet render as missing-character
// boxes. \ensuremath{...} renders them via the math font (Computer Modern), which always has
// them, regardless of surrounding text/math mode.
const MATH_SYMBOLS: Record<string, string> = {
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon",
  "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ι": "\\iota", "κ": "\\kappa",
  "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "π": "\\pi",
  "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau", "φ": "\\varphi", "χ": "\\chi",
  "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi",
  "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
  "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq",
  "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv",
  "±": "\\pm", "∞": "\\infty", "∑": "\\sum", "∏": "\\prod", "√": "\\sqrt{}",
  "∂": "\\partial", "∇": "\\nabla",
};
const MATH_SYMBOL_RE = new RegExp(Object.keys(MATH_SYMBOLS).join("|"), "g");

// LaTeX special chars → escaped. Order matters: backslash first, then the Unicode math-symbol
// substitution last (it introduces new backslashes that must not be re-escaped).
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(MATH_SYMBOL_RE, (m) => `\\ensuremath{${MATH_SYMBOLS[m]}}`);
}

// The canonical "Jake's Resume" preamble + macros, verbatim.
const PREAMBLE = `\\documentclass[letterpaper,11pt]{article}
\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\ifdefined\\pdfoutput
  \\ifnum\\pdfoutput>0
    \\input{glyphtounicode}
  \\fi
\\fi
\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}
\\urlstyle{same}
\\raggedbottom
\\raggedright
\\sloppy
\\setlength{\\emergencystretch}{2em}
\\setlength{\\tabcolsep}{0in}
\\titleformat{\\section}{\\vspace{-4pt}\\scshape\\raggedright\\large}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]
\\ifdefined\\pdfoutput
  \\ifnum\\pdfoutput>0
    \\pdfgentounicode=1
  \\fi
\\fi
\\newcommand{\\resumeItem}[1]{\\item\\small{{#1 \\vspace{-2pt}}}}
\\newcommand{\\resumeSubheading}[4]{\\vspace{-2pt}\\item\\begin{tabularx}{0.97\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}X@{\\hspace{1em}}r@{}}\\textbf{#1} & #2 \\\\ \\textit{\\small#3} & \\textit{\\small #4}\\end{tabularx}\\vspace{-7pt}}
\\newcommand{\\resumeProjectHeading}[2]{\\item\\begin{tabularx}{0.97\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}X@{\\hspace{1em}}r@{}}\\small#1 & #2\\end{tabularx}\\vspace{-7pt}}
\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}
`;

type SectionKind = "education" | "experience" | "project" | "skill";

function classifySection(heading: string): SectionKind {
  const h = heading.toLowerCase();
  if (h.includes("education")) return "education";
  if (h.includes("project")) return "project";
  if (h.includes("skill") || h.includes("technical")) return "skill";
  if (h.includes("experience") || h.includes("work")) return "experience";
  return "experience"; // default: unknown sections render like experience
}

function renderBullets(bullets: string[]): string {
  if (!bullets.length) return "";
  return (
    `\\resumeItemListStart\n` +
    bullets.map((b) => `\\resumeItem{${escapeLatex(b)}}`).join("\n") +
    `\n\\resumeItemListEnd\n`
  );
}

function renderSubheadingEntry(e: ResumeEntry): string {
  const title = escapeLatex(e.title);
  const dates = escapeLatex(e.dates ?? "");
  const org = escapeLatex(e.organization ?? "");
  const loc = escapeLatex(e.location ?? "");
  return `\\resumeSubheading{${title}}{${dates}}{${org}}{${loc}}\n${renderBullets(e.bullets)}`;
}

function renderProjectEntry(e: ResumeEntry): string {
  const titlePart = `\\textbf{${escapeLatex(e.title)}}` + (e.organization ? ` $|$ \\emph{${escapeLatex(e.organization)}}` : "");
  const dates = escapeLatex(e.dates ?? "");
  return `\\resumeProjectHeading{${titlePart}}{${dates}}\n${renderBullets(e.bullets)}`;
}

function renderSkillSection(s: ResumeSection): string {
  const lines = s.entries
    .map((e) => `\\textbf{${escapeLatex(e.title)}}{: ${e.bullets.map((b) => escapeLatex(b)).join(", ")}}`)
    .join(" \\\\\n");
  return `\\section{${escapeLatex(s.heading)}}\n \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n     ${lines}\n    }}\n \\end{itemize}\n`;
}

function renderListSection(s: ResumeSection, kind: SectionKind): string {
  const renderEntry = kind === "project" ? renderProjectEntry : renderSubheadingEntry;
  const entries = s.entries.map(renderEntry).join("\n");
  return `\\section{${escapeLatex(s.heading)}}\n\\resumeSubHeadingListStart\n${entries}\n\\resumeSubHeadingListEnd\n`;
}

// A profile URL field may arrive bare ("linkedin.com/in/x"), with a scheme
// ("https://linkedin.com/in/x"), or with a trailing slash. Normalize to a clean
// display string (no scheme, no www., no trailing slash) and a well-formed https href
// with exactly one scheme.
export function linkParts(raw: string): { href: string; display: string } {
  const noScheme = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const display = noScheme.replace(/^www\./i, "");
  return { href: `https://${noScheme}`, display };
}

function renderHeader(c: ResumeContact): string {
  const linkField = (raw: string): string => {
    const { href, display } = linkParts(raw);
    return `\\href{${href}}{\\underline{${escapeLatex(display)}}}`;
  };
  const links = [
    c.email ? `\\href{mailto:${c.email}}{\\underline{${escapeLatex(c.email)}}}` : "",
    c.phone ? escapeLatex(c.phone) : "",
    c.linkedin ? linkField(c.linkedin) : "",
    c.github ? linkField(c.github) : "",
  ].filter(Boolean);
  return (
    `\\begin{center}\n` +
    `    \\textbf{\\Huge \\scshape ${escapeLatex(c.name)}} \\\\ \\vspace{1pt}\n` +
    `    \\small ${links.join(" $|$ ")}\n` +
    `\\end{center}\n`
  );
}

// Renders the "Jake's Resume" template (canonical MIT version) from a ResumeDoc.
export function renderResumeLatex(doc: ResumeDoc): string {
  const body = doc.sections
    .filter((s) => s.entries.length > 0)
    .map((s) => {
      const kind = classifySection(s.heading);
      return kind === "skill" ? renderSkillSection(s) : renderListSection(s, kind);
    })
    .join("\n");

  return (
    PREAMBLE +
    `\\begin{document}\n\n` +
    renderHeader(doc.contact) +
    `\n\n${body}\n` +
    `\\end{document}\n`
  );
}
