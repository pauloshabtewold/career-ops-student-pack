// Invented-fact gate for drafted letters and messages: every number, year, capitalized organization and skill term in a
// draft must be grounded. A claim about the student (any sentence in the first person) is grounded only by cv.md and
// the application answers, plus the target company name and role title; the posting grounds only sentences about the
// company ("your team uses Tableau"), never "I built Tableau dashboards". A model can write a fluent line about an
// employer or a metric the student never had, and the posting is where most such lines come from; this check is plain
// code so it costs no tokens and never drifts.

// Words that start a sentence or a letter and are capitalized without naming anything.
const COMMON = new Set(
  'i i\'m i\'ve i\'d my me we our you your the a an and but or so as at in on of for to with from by this that these those it its dear hello hi hiring manager team sincerely regards best thank thanks yours monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december while during after before when since because although if also here there please'.split(' '),
);

// Skill terms checked even in lowercase, since a model may write "python" as freely as "Python".
export const SKILL_TERMS = Object.freeze([
  'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'go', 'rust', 'sql', 'r', 'matlab', 'excel', 'tableau', 'power bi',
  'react', 'node', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'spark', 'hadoop', 'pandas', 'tensorflow', 'pytorch',
  'salesforce', 'sap', 'stata', 'spss', 'figma', 'git', 'linux', 'html', 'css', 'swift', 'kotlin', 'epic', 'cerner',
]);

const flatten = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? Object.values(v).map(flatten).join(' ') : String(v));
const has = (haystack, needle) => haystack.includes(needle.toLowerCase());
const normNumber = (s) => s.replace(/[,$%]/g, '');

function numbersIn(text) {
  return [...String(text).matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0]);
}

const sentencesOf = (text) => String(text).split(/(?<=[.!?:])\s+|\n+/).filter((s) => s.trim());

// Runs of capitalized words; words that are capitalized only because they open a sentence (COMMON) break a run.
function organizationsIn(text) {
  const out = [];
  for (const sentence of sentencesOf(text)) {
    const words = sentence.split(/\s+/).map((w) => w.replace(/^[("']+|[)"',.;:!?]+$/g, '')).filter(Boolean);
    let run = [];
    const flush = () => {
      if (run.length) out.push(run.join(' '));
      run = [];
    };
    for (const w of words) {
      if (/^[A-Z][A-Za-z0-9&.-]*$/.test(w) && !COMMON.has(w.toLowerCase())) run.push(w);
      else flush();
    }
    flush();
  }
  return out;
}

function skillsIn(text) {
  const lower = ` ${String(text).toLowerCase()} `;
  return SKILL_TERMS.filter((s) => new RegExp(`[^a-z0-9+#]${s.replace(/[+#]/g, '\\$&')}[^a-z0-9+#]`).test(lower));
}

const FIRST_PERSON = /(?:^|[^a-z])(?:i|me|my|mine|myself|we|us|our|ours)(?:[^a-z]|$)/i;
const SECOND_PERSON = /(?:^|[^a-z])(?:you|your|yours)(?:[^a-z]|$)/i;

// sources = { cv, answers, posting, company?, role?, extra? } where company and role (and extra, older callers) are the
// target names. Returns the unsupported items, empty when the draft passes.
export function check(text, sources = {}) {
  const targets = [sources.company, sources.role, ...[sources.extra].flat()].filter((t) => typeof t === 'string' && t.trim()).map((t) => t.toLowerCase());
  const student = [sources.cv, flatten(sources.answers), ...targets].join('\n').toLowerCase();
  const company = `${student}\n${String(sources.posting ?? '').toLowerCase()}`;
  const numbers = { student: new Set(numbersIn(student).map(normNumber)), company: new Set(numbersIn(company).map(normNumber)) };
  const missing = new Map();
  const add = (item) => missing.set(item.toLowerCase(), missing.get(item.toLowerCase()) ?? item);
  for (const sentence of sentencesOf(text)) {
    const lower = sentence.toLowerCase();
    const aboutCompany = !FIRST_PERSON.test(sentence) && (SECOND_PERSON.test(sentence) || targets.some((t) => lower.includes(t)));
    const pool = aboutCompany ? company : student;
    const poolNumbers = aboutCompany ? numbers.company : numbers.student;
    for (const n of numbersIn(sentence)) if (!poolNumbers.has(normNumber(n))) add(n);
    for (const org of organizationsIn(sentence)) if (!has(pool, org)) add(org);
    for (const skill of skillsIn(sentence)) if (!has(pool, skill)) add(skill);
  }
  return [...missing.values()];
}
