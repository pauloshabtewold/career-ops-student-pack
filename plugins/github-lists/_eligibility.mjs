// Keeps a list row only when it fits the student's cycle and the preset's title rules.
// Cycle terms and years come from data/student-cycle.json, written by scripts/cycle.mjs.
const TERM_RE = /\b(summer|fall|winter|spring)\s+(20\d\d)\b/gi;
const YEAR_RE = /\b(20\d\d)\b/g;
const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect)\b/i;
const PHD_RE = /\bph\.?\s?d\b/i;
const NON_PHD_RE = /\b(bachelor|bachelors|b\.?s\.?|master|masters|m\.?s\.?|undergrad|undergraduate)\b/i;

const matchAny = (patterns, text) => (patterns ?? []).some((p) => new RegExp(p, 'i').test(text));

function termsIn(text) {
  return [...text.matchAll(TERM_RE)].map((m) => `${m[1].toLowerCase()} ${m[2]}`);
}

export function isEligible(row, { cycle, titleRules = {}, earlyCareer } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  const title = row.title ?? '';
  if (SENIOR_RE.test(title)) return fail('senior title');
  if (PHD_RE.test(title) && !NON_PHD_RE.test(title)) return fail('PhD-only role');
  if (earlyCareer && !new RegExp(earlyCareer, 'i').test(title)) return fail('not an early-career title');
  if (titleRules.include?.length && !matchAny(titleRules.include, title)) return fail('no include rule matched');
  if (matchAny(titleRules.exclude, title)) return fail('matched an exclude rule');

  if (row.kind === 'internship') {
    const wanted = new Set((cycle?.terms ?? []).map((t) => `${String(t.name).toLowerCase()} ${t.year}`));
    const stated = termsIn(`${title} ${row.date ?? ''}`);
    if (stated.length && !stated.some((t) => wanted.has(t))) return fail('term outside the cycle');
  } else if (row.kind === 'newgrad') {
    const years = [...title.matchAll(YEAR_RE)].map((m) => Number(m[1]));
    if (years.length && !years.some((y) => (cycle?.newgrad_years ?? []).includes(y))) return fail('graduation year outside the cycle');
  }
  return { ok: true, reason: '' };
}
