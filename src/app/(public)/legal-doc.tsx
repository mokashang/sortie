import type { Messages } from "@/i18n/messages";

// The day either document last changed (shown at the top of both). Bump it with the text.
export const LEGAL_UPDATED = "2026-09-14";

// Where a reader can reach the operator; both documents end with it. Change it here.
export const OPERATOR_EMAIL = "shangmengjiajiajia@gmail.com";

// Renders one of the two documents in src/i18n/messages/legal.ts: title, the meta line, the
// intro, then each section — a string block is a paragraph, a list block a bullet list — and the
// operator's address as the last line (the closing section's text leads into it).
export function LegalDocView({ m, which }: { m: Messages; which: "privacy" | "terms" }) {
  const doc = m.legal[which];
  return (
    <article className="legal-doc">
      <h1>{doc.title}</h1>
      <p className="legal-meta">
        <span>
          {m.legal.updatedLabel} <span className="mono">{LEGAL_UPDATED}</span>
        </span>
        <span>{m.legal.operatorLine}</span>
      </p>
      <p className="legal-intro">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.body.map((b, i) =>
            typeof b === "string" ? (
              <p key={i}>{b}</p>
            ) : (
              <ul key={i}>
                {b.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            )
          )}
        </section>
      ))}
      <p className="legal-contact">
        <a className="accent" href={`mailto:${OPERATOR_EMAIL}`}>
          {OPERATOR_EMAIL}
        </a>
      </p>
    </article>
  );
}
