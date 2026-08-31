// US-only location hard filter (spec: the user is an F-1 student who only wants US-based
// roles). Philosophy MUST mirror visa-filter.ts exactly: only flag CLEARLY foreign locations —
// ambiguous ones ("Remote", "SF", null, "flexible", an unlisted city with no country attached)
// stay unflagged (fail open). A false flag silently hides a job the user could actually take; a
// missed flag costs one wasted queue slot. When both a US and a foreign signal appear in the
// same location string (a multi-office posting like "New York; London"), the US signal always
// wins — the candidate can take the US office.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Letter-boundary match: a phrase only counts as present when it isn't a substring of a longer
// word on either side. Deliberately not \b — \b doesn't anchor reliably right after punctuation
// (e.g. the trailing "." in "U.S." or "D.C."), since \b only fires at a word/non-word transition
// and "." is itself non-word. Checking "not preceded/followed by a letter" instead sidesteps that
// and is exactly the guard load-bearing for cases like "LA" not matching inside "Atlanta" or "US"
// not matching inside "Housing".
function phraseRegex(phrase: string): RegExp {
  const escaped = escapeRegex(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i");
}

const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
];
// Comma-context required: a bare 2-letter code (IN, OR, ME, HI, ...) collides with common
// English words, so only "<city>, XX" style location strings count as a state-code signal.
const US_STATE_CODE_RE = new RegExp(`,\\s*(?:${US_STATE_CODES.join("|")})\\b`, "i");
// "US" as its own token (e.g. "US - Remote", "Remote, US"). Doesn't cost us anything against
// "USA" (immediately followed by a letter, so the lookahead below fails there) or mid-word hits
// like "hoUSing".
const US_BARE_TOKEN_RE = /(?<![A-Za-z])US(?![A-Za-z])/i;

const US_PHRASES = [
  "United States",
  "USA",
  "U.S.",
  // Major US cities/metros commonly listed without a trailing state code.
  "San Francisco", "SF", "NYC", "New York", "Seattle", "Chicago", "Austin", "Boston", "Atlanta",
  "Denver", "Miami", "Los Angeles", "LA", "San Jose", "Palo Alto", "Mountain View",
  "Santa Clara", "Sunnyvale", "Menlo Park", "Cupertino", "San Diego", "Washington, D.C.",
  "Bellevue", "Redmond", "Portland", "Dallas", "Houston", "Phoenix", "Philadelphia",
  "Pittsburgh", "Detroit", "Minneapolis", "Salt Lake City", "Nashville", "Charlotte", "Raleigh",
  "Durham", "Boulder", "Pasadena", "Berkeley", "Oakland", "Somerville",
  "Jersey City", "Brooklyn", "Manhattan", "Stamford", "Greenwich", "Hartford", "Columbus",
  "Madison", "Ann Arbor", "Champaign", "Urbana", "Bloomington", "Reston", "Arlington",
  "McLean", "Bethesda", "Tempe", "Plano",
  // "Cambridge" and "Irvine" are handled separately below (AMBIGUOUS_US_CITIES) — both are also
  // real foreign cities (Cambridge, UK; Irvine, Scotland), so a bare match here isn't safe.
];
const US_PHRASE_RES = US_PHRASES.map(phraseRegex);

// A small set of whitelisted US cities that collide with a well-known foreign city of the same
// name. A bare match must NOT count as a US signal when it's immediately qualified by one of
// these foreign markers ("Cambridge, UK", "Irvine, UK") — otherwise a clearly-foreign location
// would slip through unflagged purely because of the name collision. Without a foreign
// qualifier right there, the name still defaults to its US reading (bare "Cambridge" stays a US
// signal, matching the rest of this file's fail-open philosophy for anything not explicit).
const AMBIGUOUS_US_CITIES: Record<string, string[]> = {
  Cambridge: ["UK", "United Kingdom"],
  Irvine: ["UK", "United Kingdom", "Scotland"],
};
const AMBIGUOUS_US_CITY_RES = Object.entries(AMBIGUOUS_US_CITIES).map(([city, foreignQualifiers]) => {
  const escapedCity = escapeRegex(city);
  const qualifierAlt = foreignQualifiers.map(escapeRegex).join("|");
  return new RegExp(
    `(?<![A-Za-z])${escapedCity}(?![A-Za-z])(?!\\s*,\\s*(?:${qualifierAlt})\\b)`,
    "i"
  );
});

const FOREIGN_PHRASES = [
  // Countries. Deliberately omits ambiguous names that collide with a US state (e.g. "Georgia")
  // — that ambiguity must resolve to null (fail open), not a flag.
  "Canada", "UK", "United Kingdom", "England", "India", "China", "Japan", "Korea", "Singapore",
  "Germany", "France", "Netherlands", "Ireland", "Poland", "Israel", "Australia", "Brazil",
  "Mexico", "Spain", "Italy", "Sweden", "Switzerland", "Austria", "Belgium", "Denmark", "Norway",
  "Finland", "Portugal", "Czech", "Romania", "Hungary", "Serbia", "Ukraine", "Taiwan", "Vietnam",
  "Thailand", "Philippines", "Indonesia", "Malaysia", "UAE", "Saudi", "Egypt", "Nigeria", "Kenya",
  "South Africa", "Argentina", "Colombia", "Chile", "Peru", "New Zealand",
  // Major foreign cities/tech hubs.
  "London", "Toronto", "Vancouver", "Montreal", "Ottawa", "Waterloo", "Dublin", "Amsterdam",
  "Berlin", "Munich", "Paris", "Zurich", "Zug", "Geneva", "Stockholm", "Copenhagen", "Oslo",
  "Helsinki", "Warsaw", "Krakow", "Kraków", "Prague", "Vienna", "Budapest", "Bucharest",
  "Belgrade", "Lisbon", "Madrid", "Barcelona", "Milan", "Rome", "Tel Aviv", "Dubai", "Abu Dhabi",
  "Bangalore", "Bengaluru", "Hyderabad", "Mumbai", "Delhi", "Gurgaon", "Gurugram", "Pune",
  "Chennai", "Noida", "Tokyo", "Osaka", "Seoul", "Beijing", "Shanghai", "Shenzhen", "Hangzhou",
  "Hong Kong", "Taipei", "Sydney", "Melbourne", "Brisbane", "Auckland", "São Paulo", "Sao Paulo",
  "Mexico City", "Bogotá", "Bogota", "Buenos Aires", "Cairo", "Lagos", "Nairobi",
];
const FOREIGN_PHRASE_RES = FOREIGN_PHRASES.map(phraseRegex);

function hasUsSignal(text: string): boolean {
  return (
    US_STATE_CODE_RE.test(text) ||
    US_BARE_TOKEN_RE.test(text) ||
    US_PHRASE_RES.some((r) => r.test(text)) ||
    AMBIGUOUS_US_CITY_RES.some((r) => r.test(text))
  );
}

function hasForeignSignal(text: string): boolean {
  return FOREIGN_PHRASE_RES.some((r) => r.test(text));
}

export type LocFlag = "non_us" | null;

export function locFlag(location: string | null | undefined): LocFlag {
  if (!location) return null;
  // Multi-location rule: any US signal wins, even alongside a foreign city ("New York; London").
  if (hasUsSignal(location)) return null;
  if (hasForeignSignal(location)) return "non_us";
  return null;
}
