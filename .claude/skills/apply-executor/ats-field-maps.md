# ATS field maps (Tier A accelerators)

These are known-good selectors and field notes for the three ATS platforms common enough to be
worth hardcoding: Greenhouse (~17% of the real job pool this app scans), Ashby (~16%), Lever (~6%).
Workday (~19%) and everything else (~43%) have no stable map — use the generic Tier B/C strategy
in SKILL.md §3 for those.

**These maps are accelerators, not guarantees.** A company can customize their ATS instance's
form (custom fields, reordered sections, renamed labels, an embedded iframe). Whenever a selector
below doesn't match what `read_page` actually shows, don't force it — fall back to reading the
form generically for that field (match by visible label text and input type) while still using
the map for whichever fields *do* match. Always `read_page` first to confirm the DOM shape before
blindly trusting a selector from this file.

---

## Greenhouse (`boards.greenhouse.io`, `job-boards.greenhouse.io`, embedded `grnh.se` links)

Standard fields, usually present as plain `<input>`/`<select>` with predictable ids:

| Field | Selector | Answer pack source |
|---|---|---|
| First name | `#first_name` | `contact.first_name` |
| Last name | `#last_name` | `contact.last_name` |
| Email | `#email` | `contact.email` |
| Phone | `#phone` | `contact.phone` |
| Resume upload | button/input labeled "Attach" or "Upload" near "Resume/CV" — often `#resume` or a `.attach` widget with a hidden `<input type=file>` | `file_upload` with `resume.pdf_path` |
| LinkedIn URL | `#job_application_answers_attributes_X_text_value` next to a "LinkedIn Profile" label, or a dedicated `#linkedin` if present | `contact.linkedin_url` |
| School | Select near "School" label, often a searchable combobox (`#education_school_name` or similar) | `education.school` |
| Degree | Select near "Degree" label | `education.degree` |
| Graduation date | Month/Year selects near "Graduation" | `education.grad_month_year` (split "May 2026" into month="May", year="2026" if the widget wants two separate selects) |
| "How did you hear about us?" | Select or text field, label varies ("How did you hear about this job?", "Source") | Default `"Job board"` unless `custom` has an explicit override |
| EEO section (voluntary) | A block near the bottom titled "Voluntary Self-Identification" with separate Gender/Race/Veteran/Disability selects | `eeo.gender` / `eeo.race` / `eeo.veteran` / `eeo.disability` respectively |

Notes:
- Greenhouse's EEO selects usually have option text close to the default phrasing already in
  `profile.eeo` (e.g. "I don't wish to answer", "Decline to self-identify") — match by closest
  text, don't leave them on a random default option.
- Custom questions (free-text) beyond the standard block are Tier B territory even on a
  Greenhouse form — only fill them if you can confidently map the label to `answerPack.custom` or
  another field; otherwise they go to `unanswered`.

---

## Lever (`jobs.lever.co`)

Simpler, shorter form — usually one page:

| Field | Selector | Answer pack source |
|---|---|---|
| Full name | Single `input[name="name"]` (not split first/last) | `contact.full_name` |
| Email | `input[name="email"]` | `contact.email` |
| Phone | `input[name="phone"]` | `contact.phone` |
| Resume upload | `input[type="file"][name="resume"]` (often behind a styled "Submit resume/CV" dropzone) | `file_upload` with `resume.pdf_path` |
| LinkedIn / URLs | `input[name="urls[LinkedIn]"]` (and similarly `urls[GitHub]`, `urls[Portfolio]` if present) | `contact.linkedin_url` / `contact.github_url` |
| "How did you hear about us?" | `select[name="comments"]` or a dedicated dropdown, wording varies | Default `"Job board"` |
| Additional info / cover letter box | Free-text `textarea` | Leave empty, add to `unanswered` — this skill does not generate cover letters (v1) |

Notes:
- Lever forms rarely have an EEO block; when they do, it's a separate "Demographic Questions"
  section near the bottom, same rule as Greenhouse's EEO block above.
- Because Lever uses one name field, don't try to split `contact.full_name` — use it as-is.

---

## Ashby (`jobs.ashbyhq.com`)

React-driven form; fields carry `_systemfield_*` names for the standard ones:

| Field | Selector | Answer pack source |
|---|---|---|
| Name | `[name="_systemfield_name"]` | `contact.full_name` |
| Email | `[name="_systemfield_email"]` | `contact.email` |
| Phone | Often a separate custom field, label "Phone Number" | `contact.phone` |
| Resume upload | `[name="_systemfield_resume"]` (hidden file input behind a dropzone — click the dropzone first if `file_upload` targeting the input directly doesn't register) | `file_upload` with `resume.pdf_path` |
| LinkedIn | Custom field, label "LinkedIn URL" or similar, name usually `_customfield_<uuid>` — match by visible label text, not by name | `contact.linkedin_url` |
| Location | Custom field, label "Location" | `contact.location` if non-empty, else leave and add to `unanswered` |
| EEO / demographic questions | Separate custom fields near the end, labels close to standard EEO wording | Match to `eeo.*` by label text |

Notes:
- Ashby's non-system fields are all `_customfield_<uuid>` — there is no stable id map for them.
  Always match by the field's visible label text via `read_page`, not by assuming a name pattern.
- Ashby forms are React-controlled inputs: after `form_input` sets a value, verify with
  `read_page`/`javascript_tool` that the value actually stuck (React sometimes needs a proper
  input/change event, not just a raw DOM value assignment) before reporting it as filled.

---

## Cross-platform defaults

- **"How did you hear about us?"** (or any close variant: "How did you hear about this
  opportunity?", "Referral source?") — default to `"Job board"` when the form offers it as an
  option and `answerPack.custom` has no explicit override for that exact question text. If
  `answerPack.custom` does have a matching key, prefer that instead.
- **Voluntary EEO/demographic sections** — always map to `answerPack.eeo`, never leave on a
  platform's arbitrary first option (which may not mean "decline to answer").
- **Resume upload** — always `file_upload` with `answerPack.resume.pdf_path` (an absolute path to
  a compiled PDF); never re-type or paste resume text into a text field even if one is offered as
  an alternative to uploading.
- **Anything not in this file** — fall back to SKILL.md's Tier B/C generic strategy: read the
  label, only fill on high-confidence matches, everything else goes to `unanswered`.
