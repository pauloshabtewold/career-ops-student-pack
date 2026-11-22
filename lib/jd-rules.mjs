// Free job-text filters that run before any model call. Each rule reads only the posting text and the student's config
// and returns its rule name when the posting cannot fit, so a row the student could never take costs no tokens. The
// rules are conservative: a phrase that only prefers a qualification never fails a row.

const PREFERRED = /\b(preferred|a plus|nice to have|bonus|ideally|desired)\b/i;

const sentences = (text) => String(text ?? '').split(/(?<=[.!?;])\s+|\n+/);

// Requirement forms only: "N+ years", "at least / minimum (of) N years", "N or more years", "requires N years" and an
// "N-M years of experience" range. Company blurbs ("over 20 years of experience serving", "for 10 years", "a team with
// 10+ years", "founded") and ages ("18 years of age") are not requirements.
const YEARS_FORMS = [
  /\b(\d{1,2})\s*\+\s*years?\b/gi,
  /\b(?:at least|minimum(?: of)?|min\.)\s+(\d{1,2})\s+years?\b/gi,
  /\b(\d{1,2})\s+or more years?\b/gi,
  /\brequires?\s+(\d{1,2})\s+years?\b/gi,
  /\b(\d{1,2})\s*(?:-|to)\s*\d{1,2}\s+years?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}?experience\b/gi,
];
const BLURB_SENTENCE = /\b(founded|in business|serving|track record|our history|since \d{4})\b/i;
const BLURB_BEFORE = /\b(team|company|organization|firm|group|we|our|us|has|over|for)\b[^.]{0,30}$/i;
// A requirement verb just before the number outweighs a blurb word ("We require 15+ years", "We are looking for 5+
// years", "Requirements for this role: 5+ years").
const ASKS_BEFORE = /\b(require[sd]?|requirements?|looking for|seek(ing)?|need(ed|s)?|want|expect|must have|should have|you have|you bring)\b[^.]{0,20}$/i;
const NOT_EXPERIENCE = /^[^.]{0,12}\byears?\s+(of age|old|remaining|left)\b/i;
// What the years are about, read from the few words after "years": school, study, commitment and residency years are not
// experience; an experience word counts; "N+ years of <skill>" (or in, as, at a role or setting) counts in a requirement
// sentence.
const YEARS_TAIL = /^[^.;,()]{0,60}/;
const STUDY_TAIL = /\b(study|studies|coursework|college|undergraduate|university|school|program|commitment|degree|enrolled|remaining|graduation|eligibility|residen\w*|lived|living|citizen\w*|age|old)\b|\bin the (us|u\.s\.|united states|country)\b/i;
const EXPERIENCE_TAIL = /^\s*(?:of\s+)?(?:[\w'+#./-]+\s+){0,4}?(experience|industry|professional|work|hands-on|relevant)\b/i;
const REQUIREMENT_SENTENCE = /\b(requir\w*|qualifications?|must|minimum|at least|need(ed|s)?|you have|you bring|should have|looking for|seek\w*|expect\w*)\b/i;

function aboutExperience(sentence, tail) {
  const words = YEARS_TAIL.exec(tail)?.[0] ?? '';
  if (STUDY_TAIL.test(words)) return false;
  if (EXPERIENCE_TAIL.test(words)) return true;
  return /^\s*(of|in|as|at|with|doing|working)\s+\S/i.test(words) && REQUIREMENT_SENTENCE.test(sentence);
}

// Highest number of years of experience a requirement sentence asks for, ignoring preferred qualifications, company
// blurbs and years of study.
export function requiredYears(text) {
  let max = 0;
  for (const s of sentences(text)) {
    if (PREFERRED.test(s) || BLURB_SENTENCE.test(s)) continue;
    for (const re of YEARS_FORMS) {
      for (const m of s.matchAll(re)) {
        const before = s.slice(0, m.index);
        if ((BLURB_BEFORE.test(before) && !ASKS_BEFORE.test(before)) || NOT_EXPERIENCE.test(s.slice(m.index))) continue;
        if (!/experience$/i.test(m[0]) && !aboutExperience(s, s.slice(m.index + m[0].length))) continue;
        max = Math.max(max, Number(m[1]));
      }
    }
  }
  return max;
}

const DEGREE_RANK = { bachelor: 1, master: 2, doctorate: 3 };
const DEGREE_REQ = [
  ['doctorate', /\b(ph\.?d\.?|doctorate|doctoral degree)\b[^.]{0,40}\b(required|must have)\b|\b(requires?|must have)\b[^.]{0,40}\b(ph\.?d\.?|doctorate)\b/i],
  ['master', /\b(master'?s|m\.s\.|mba)\b[^.]{0,40}\b(required|must have)\b|\b(requires?|must have)\b[^.]{0,40}\b(master'?s|mba)\b/i],
];
// "Bachelor's or Master's", "or equivalent", "or related experience": the sentence accepts more than one path.
const DEGREE_ALTERNATIVE = /\bor\b|\bequivalent\b/i;

// Scans sentences for a required degree; preferred and either/or sentences are skipped.
export function requiredDegree(text) {
  for (const s of sentences(text)) {
    if (PREFERRED.test(s) || DEGREE_ALTERNATIVE.test(s)) continue;
    for (const [level, re] of DEGREE_REQ) if (re.test(s)) return level;
  }
  return null;
}

export const CLOSED = /\b(no longer accepting applications|this (job|position|posting) (has been|is) (closed|filled)|posting has expired|applications (are|have) closed|position has been filled)\b/i;

const REMOTE = /\b(remote|work from home|anywhere)\b/i;
const ONSITE_ONLY = /\b(on-?site only|must (work|be) on-?site|fully on-?site|in-office five days)\b/i;
const STATES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey',
  NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
  PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};
const STATE_BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [name, code]));
// Big cities written without a state; a whole-string match only, so "NYC metro" stays a region.
const CITY_STATE = new Map([
  ['new york city', 'NY'], ['nyc', 'NY'], ['manhattan', 'NY'], ['brooklyn', 'NY'], ['san francisco', 'CA'], ['los angeles', 'CA'],
  ['san diego', 'CA'], ['san jose', 'CA'], ['seattle', 'WA'], ['boston', 'MA'], ['chicago', 'IL'], ['austin', 'TX'],
  ['dallas', 'TX'], ['houston', 'TX'], ['atlanta', 'GA'], ['denver', 'CO'], ['miami', 'FL'], ['philadelphia', 'PA'],
  ['pittsburgh', 'PA'], ['phoenix', 'AZ'], ['portland', 'OR'], ['minneapolis', 'MN'], ['detroit', 'MI'], ['nashville', 'TN'],
  ['washington dc', 'DC'], ['washington, dc', 'DC'], ['washington d.c.', 'DC'],
]);

// The US state one place names ("Austin, TX", "Texas", "Seattle"), or null when it is a country, region or unknown name.
function stateOf(place) {
  const s = String(place ?? '').trim().replace(/\s+/g, ' ');
  const low = s.toLowerCase().replace(/[.]$/, '');
  if (CITY_STATE.has(low)) return CITY_STATE.get(low);
  if (STATE_BY_NAME.has(low)) return STATE_BY_NAME.get(low);
  const coded = /,\s*([A-Za-z]{2})(?:\s+\d{5})?$/.exec(s)?.[1]?.toUpperCase();
  if (coded && STATES[coded]) return coded;
  const named = /,\s*([A-Za-z ]+)$/.exec(s)?.[1]?.trim().toLowerCase();
  return named && STATE_BY_NAME.has(named) ? STATE_BY_NAME.get(named) : null;
}

// Places in one posting location: split on ; | / & and a lowercase "or" or "and" (an upper-case OR is Oregon), and on a
// comma that follows a two-letter state code ("Austin, TX, Seattle, WA"). A part still holding two state codes is not
// understood, so the rule passes it.
const PLACE_SPLIT = /\s*(?:;|\||\/|\bor\b|\band\b|&)\s*|(?<=,\s*[A-Za-z]{2})\s*,\s*/;
const STATE_CODE = /,\s*[A-Z]{2}\b/g;

// A located posting fails only on a clear mismatch: every place the student listed is a US state or city, every place
// the posting names is a US state or city, none of them shares a state, and the posting is not remote. A multi-city
// posting is read as all of its places. Countries ("United States", "Remote - US"), regions ("Bay Area", "NYC metro") and
// unknown names on either side pass. A posting in another city of a listed state passes too: that is for the model to
// weigh.
export function locationMismatch(rowLocation, jobText, locations = []) {
  if (!locations.length) return null;
  const wantRemote = locations.some((l) => REMOTE.test(l));
  const wantsOnlyRemote = locations.every((l) => REMOTE.test(l));
  const place = String(rowLocation ?? '').trim();
  const postingRemote = REMOTE.test(place) || (REMOTE.test(jobText ?? '') && !ONSITE_ONLY.test(jobText ?? ''));
  if (wantsOnlyRemote && ONSITE_ONLY.test(jobText ?? '')) return 'work mode';
  if (!place || /^unknown$/i.test(place) || postingRemote) return null;
  if (wantRemote && !ONSITE_ONLY.test(jobText ?? '')) return null;
  const listed = locations.filter((l) => !REMOTE.test(l)).map(stateOf);
  if (!listed.length || listed.includes(null)) return null;
  const places = place.split(PLACE_SPLIT).map((p) => p?.trim()).filter(Boolean);
  if (places.some((p) => (p.match(STATE_CODE) ?? []).length > 1)) return null;
  const posted = places.map(stateOf);
  if (!posted.length || posted.includes(null)) return null;
  return posted.some((st) => listed.includes(st)) ? null : 'location';
}

// The first failing rule for one posting, or null. student = { experienceYears, degree, locations, never }; a null degree
// skips the degree rule.
export function jdRule({ text, location }, student = {}) {
  if (CLOSED.test(text ?? '')) return 'closed';
  const years = requiredYears(text);
  if (years && years >= (student.experienceYears ?? 0) + 3) return 'years';
  const degree = requiredDegree(text);
  if (degree && DEGREE_RANK[student.degree] && DEGREE_RANK[degree] > DEGREE_RANK[student.degree]) return 'degree';
  const place = locationMismatch(location, text, student.locations);
  if (place) return place;
  if ((student.never ?? []).some((re) => new RegExp(re, 'i').test(text ?? ''))) return 'never keyword';
  if ((student.mustHave ?? []).length && !(student.mustHave ?? []).some((w) => new RegExp(w, 'i').test(text ?? ''))) return 'must-have keyword';
  return null;
}

// degree is the config's optional level; unset (or absent) turns the degree rule off.
export const studentFromConfig = (config = {}) => ({
  experienceYears: config.experience_years ?? 0,
  degree: DEGREE_RANK[config.degree] ? config.degree : null,
  locations: config.locations ?? [],
  never: config.dealbreakers ?? [],
});
