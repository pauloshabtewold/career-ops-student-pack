// Invented-fact gate for drafted letters and messages: every number, year, capitalized organization and skill term in a
// draft must appear in the student's cv.md, their application answers or the posting. A model can write a fluent line
// about an employer or a metric the student never had; this check is plain code so it costs no tokens and never drifts.

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

// Runs of capitalized words; words that are capitalized only because they open a sentence (COMMON) break a run.
function organizationsIn(text) {
  const out = [];
  for (const sentence of String(text).split(/(?<=[.!?:])\s+|\n+/)) {
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

// sources = { cv, answers, posting }; returns the unsupported items, empty when the draft passes.
export function check(text, sources = {}) {
  const pool = [sources.cv, flatten(sources.answers), sources.posting, flatten(sources.extra)].join('\n').toLowerCase();
  const poolNumbers = new Set(numbersIn(pool).map(normNumber));
  const missing = new Map();
  const add = (item) => missing.set(item.toLowerCase(), missing.get(item.toLowerCase()) ?? item);
  for (const n of numbersIn(text)) if (!poolNumbers.has(normNumber(n))) add(n);
  for (const org of organizationsIn(text)) if (!has(pool, org)) add(org);
  for (const skill of skillsIn(text)) if (!has(pool, skill)) add(skill);
  return [...missing.values()];
}
