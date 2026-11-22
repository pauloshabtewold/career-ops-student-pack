// Free job-text filters that run before any model call. Each rule reads only the posting text and the student's config
// and returns its rule name when the posting cannot fit, so a row the student could never take costs no tokens. The
// rules are conservative: a phrase that only prefers a qualification never fails a row.

const PREFERRED = /\b(preferred|a plus|nice to have|bonus|ideally|desired)\b/i;

const sentences = (text) => String(text ?? '').split(/(?<=[.!?;])\s+|\n+/);

// Highest "N+ years of experience" a sentence requires, ignoring preferred qualifications.
export function requiredYears(text) {
  let max = 0;
  for (const s of sentences(text)) {
    if (PREFERRED.test(s)) continue;
    for (const m of s.matchAll(/\b(\d{1,2})\s*(?:\+|or more)?\s*(?:-\s*\d{1,2}\s*)?years?\s+(?:of\s+)?(?:\w+\s+){0,3}?experience\b/gi)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

const DEGREE_RANK = { bachelor: 1, master: 2, doctorate: 3 };
const DEGREE_REQ = [
  ['doctorate', /\b(ph\.?d\.?|doctorate|doctoral degree)\b[^.]{0,40}\b(required|must have)\b|\b(requires?|must have)\b[^.]{0,40}\b(ph\.?d\.?|doctorate)\b/i],
  ['master', /\b(master'?s|m\.s\.|mba)\b[^.]{0,40}\b(required|must have)\b|\b(requires?|must have)\b[^.]{0,40}\b(master'?s|mba)\b/i],
];

// Scans sentences for a required degree; sentences that say preferred are skipped.
export function requiredDegree(text) {
  for (const s of sentences(text)) {
    if (PREFERRED.test(s)) continue;
    for (const [level, re] of DEGREE_REQ) if (re.test(s)) return level;
  }
  return null;
}

export const CLOSED = /\b(no longer accepting applications|this (job|position|posting) (has been|is) (closed|filled)|posting has expired|applications (are|have) closed|position has been filled)\b/i;

const REMOTE = /\b(remote|work from home|anywhere)\b/i;
const ONSITE_ONLY = /\b(on-?site only|must (work|be) on-?site|fully on-?site|in-office five days)\b/i;
const tokens = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// A located posting fails only when the student named locations, none of them appears in it, and neither side is remote.
export function locationMismatch(rowLocation, jobText, locations = []) {
  if (!locations.length) return null;
  const wantRemote = locations.some((l) => REMOTE.test(l));
  const wantsOnlyRemote = locations.every((l) => REMOTE.test(l));
  const place = String(rowLocation ?? '').trim();
  const postingRemote = REMOTE.test(place) || (REMOTE.test(jobText ?? '') && !ONSITE_ONLY.test(jobText ?? ''));
  if (wantsOnlyRemote && ONSITE_ONLY.test(jobText ?? '')) return 'work mode';
  if (!place || /^unknown$/i.test(place) || postingRemote) return null;
  if (wantRemote && !ONSITE_ONLY.test(jobText ?? '')) return null;
  const placeWords = new Set(tokens(place));
  const hit = locations.some((l) => tokens(l).some((w) => placeWords.has(w)));
  return hit ? null : 'location';
}

// The first failing rule for one posting, or null. student = { experienceYears, degree, locations, never }.
export function jdRule({ text, location }, student = {}) {
  if (CLOSED.test(text ?? '')) return 'closed';
  const years = requiredYears(text);
  if (years && years >= (student.experienceYears ?? 0) + 3) return 'years';
  const degree = requiredDegree(text);
  if (degree && DEGREE_RANK[degree] > DEGREE_RANK[student.degree ?? 'bachelor']) return 'degree';
  const place = locationMismatch(location, text, student.locations);
  if (place) return place;
  if ((student.never ?? []).some((re) => new RegExp(re, 'i').test(text ?? ''))) return 'never keyword';
  if ((student.mustHave ?? []).length && !(student.mustHave ?? []).some((w) => new RegExp(w, 'i').test(text ?? ''))) return 'must-have keyword';
  return null;
}

export const studentFromConfig = (config = {}) => ({ experienceYears: config.experience_years ?? 0, locations: config.locations ?? [], never: config.dealbreakers ?? [] });
