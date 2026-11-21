// Invented-fact gate for drafted letters and messages, built to fail closed. A model can write a fluent line about a
// skill or a metric the student never had, and the posting is where most such lines come from, so the posting grounds
// nothing about the student. Checks, all whole-word (token or phrase boundary, never substring) after NFKC and case
// folding:
// - Risk words: every content word of the posting and every known-tech term that cv.md and the answers lack. A risk word
//   anywhere in the letter is flagged, whatever the subject, clause or sentence ("Your team uses Tableau" is flagged when
//   the cv lacks Tableau). A posting word on the common-word list is not a risk word unless it is known tech.
// - The company name and role title pass only as names in fixed contexts (at/join/to/for/from <Company>,
//   <Company>'s, Dear <Company>, <Company> uses/needs/relies on ..., the <role> role/position/opening, apply for the
//   <role>, a wish to join or work as the <role>); anywhere else they must be in cv.md or the answers.
// - Quantities (digits, number words, fractions, multipliers, durations, ranks, ranges) must appear in cv.md or the
//   answers as the same expression or its numeric equivalent.
// - A run of capitalized words inside a sentence (an organization) must appear in cv.md or the answers; a word that is
//   capitalized only because it opens a sentence is never an organization.
// - A word mixing scripts (Latin with Cyrillic) or built of look-alike non-Latin letters is flagged.
// The check is plain code so it costs no tokens and never drifts.
import { COMMON_WORDS } from './common-words.mjs';

// Tool and skill terms checked in any case, even when the posting does not name them.
export const SKILL_TERMS = Object.freeze([
  'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'go', 'golang', 'rust', 'sql', 'r', 'matlab', 'excel', 'tableau',
  'power bi', 'looker', 'snowflake', 'react', 'node', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'k8s', 'spark',
  'pyspark', 'hadoop', 'pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch', 'keras', 'salesforce', 'sap', 'stata',
  'spss', 'sas', 'figma', 'git', 'github', 'gitlab', 'linux', 'html', 'css', 'swift', 'kotlin', 'epic', 'cerner', 'dbt',
  'airflow', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka', 'bigquery', 'redshift', 'databricks', 'jira',
  'ai', 'ml', 'llm', 'nlp', 'etl', 'api', 'graphql', 'vba', 'quickbooks', 'hubspot', 'jenkins', 'terraform', 'php', 'ruby',
  'rails', 'scala', 'julia', 'perl', 'django', 'flask', 'angular', 'vue', 'solidworks', 'autocad', 'labview', 'arduino',
  'machine learning', 'deep learning', 'computer vision', 'google analytics', 'power automate', 'sharepoint', 'alteryx',
]);

// Words that open a sentence or a letter, or name a day or month, and break a run of capitalized words.
const RUN_BREAK = new Set(
  "i i'm i've i'd i'll dear hello hi hiring manager managers team sincerely regards best thank thanks yours monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(' '),
);

const flatten = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? Object.values(v).map(flatten).join(' ') : String(v));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/[\u2018\u2019\u02bc]/g, "'");

// Tokens: letters and digits, with a trailing ++ or # kept (c++, c#); hyphens, dots and apostrophes split.
const TOKEN_RE = /[\p{L}\p{N}]+(?:\+\+|#)?/gu;
const tokensOf = (s) => [...String(s).matchAll(TOKEN_RE)].map((m) => ({ text: m[0], lower: m[0].toLowerCase(), index: m.index }));
const phraseKey = (s) => ` ${tokensOf(s.toLowerCase()).map((t) => t.lower).join(' ')} `;

// Inflected forms reduced to candidate base forms (reports -> report, forecasting -> forecast, used -> use).
function formsOf(w) {
  const out = new Set([w]);
  const add = (s) => s.length >= 2 && out.add(s);
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  for (const suf of ['ing', 'ed', 'er', 'est']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      add(stem);
      add(`${stem}e`);
      if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
      if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
    }
  }
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2));
  return out;
}

// Number words with their values; vague counts (few, several) are not quantities.
const NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000,
  dozen: 12, couple: 2, pair: 2, dozens: null, hundreds: null, thousands: null, millions: null,
});
const ORDINALS = Object.freeze({
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, twentieth: 20, hundredth: 100,
});
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');
const ORDINAL = `${Object.keys(ORDINALS).join('|')}|\\d+(?:st|nd|rd|th)`;
const UNIT = 'years?|yrs|months?|semesters?|terms?|quarters?|summers?|weeks?|days?|hours?|projects?|dashboards?|reports?|teams?|people|clients?|customers?|users?|students?|members?|apps?|tools?|models?|courses?|classes?|internships?|jobs?|roles?|awards?|times';
// Equivalent spellings of fractions and multipliers.
const EQUIVALENTS = [
  ['half', '1/2', '50%', 'halved'],
  ['third', '1/3', '33%'],
  ['quarter', '1/4', '25%'],
  ['twice', 'doubled', 'double', '2x', 'two times', '2 times', 'twofold'],
  ['thrice', 'tripled', 'triple', '3x', 'three times', '3 times', 'threefold'],
  ['quadrupled', '4x', 'four times', '4 times', 'fourfold'],
];
// Look-alike letters from Cyrillic and Greek that pass for Latin ones.
const CONFUSABLE = /^[\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0423\u0425\u0406\u0408\u0405\u03bf\u03b1\u03b5\u03b9\u03ba\u03bd\u03c1\u03c4\u03c5\u03c7\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7]+$/u;

const sentencesOf = (text) => String(text).split(/(?<=[.!?:])\s+|\n+/).filter((s) => s.trim());

// Grounding sources built once per check: cv.md plus the answers.
function ownIndex(text) {
  const lower = text.toLowerCase();
  const tokens = tokensOf(lower).map((t) => t.lower);
  const forms = new Set(tokens.flatMap((t) => [...formsOf(t)]));
  const numbers = new Set([...lower.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '')));
  const phrases = ` ${tokens.join(' ')} `;
  return { lower, tokens: new Set(tokens), forms, numbers, phrases, hasPhrase: (p) => phrases.includes(phraseKey(p)) };
}

const wordIn = (lower, w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'u').test(lower);

// True when the own text says the value n with a word or digits (3, three).
function ownHasValue(own, n) {
  if (n === null || n === undefined) return false;
  if (own.numbers.has(String(n))) return true;
  return Object.entries(NUMBER_WORDS).some(([w, v]) => v === n && own.tokens.has(w));
}

// Quantity expressions in a masked sentence, each { text, grounded(own) }. Matched spans are blanked so a later pattern
// never reports the same words twice.
function quantitiesIn(sentence) {
  let s = sentence.toLowerCase();
  const out = [];
  const take = (re, make) => {
    s = s.replace(re, (...m) => {
      const q = make(...m);
      if (q) out.push(q);
      return ' '.repeat(m[0].length);
    });
  };
  const B = '(?<![\\p{L}\\p{N}])';
  const E = '(?![\\p{L}\\p{N}])';
  const durationQ = (text, n, unit) => ({
    text,
    grounded: (own) => wordIn(own.lower, text) || new RegExp(`${B}(?:${n === 1 ? 'a|an|one|1' : [n, ...Object.keys(NUMBER_WORDS).filter((w) => NUMBER_WORDS[w] === n)].join('|')})[\\s-]+${unit}s?${E}`, 'u').test(own.lower),
  });
  // Ranges: 2-3 years, 2 to 3.
  take(new RegExp(`${B}(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:-|\\u2013|to)\\s*(\\d[\\d,]*(?:\\.\\d+)?)${E}`, 'gu'), (m, a, b) => ({
    text: m.trim(),
    grounded: (own) => new RegExp(`${B}${escapeRe(a)}\\s*(?:-|\\u2013|to)\\s*${escapeRe(b)}${E}`, 'u').test(own.lower),
  }));
  take(new RegExp(`${B}half\\s+a\\s+decade${E}`, 'gu'), (m) => durationQ(m, 5, 'year'));
  take(new RegExp(`${B}(?:a|an|one)\\s+(year|month|semester)\\s+and\\s+a\\s+half${E}`, 'gu'), (m) => ({ text: m, grounded: (own) => wordIn(own.lower, m) }));
  take(new RegExp(`${B}(?:a|an|one|1)\\s+decade${E}|${B}decades?${E}`, 'gu'), (m) => (/^decades$/.test(m) ? { text: m, grounded: (own) => wordIn(own.lower, m) } : durationQ(m, 10, 'year')));
  take(new RegExp(`${B}(?:a|an|one)\\s+(year|month|semester|quarter|term)${E}`, 'gu'), (m, unit) => durationQ(m, 1, unit));
  // Fractions and multipliers.
  take(new RegExp(`${B}(?:(?:a|one|by\\s+a|by\\s+one|two)\\s+)(third|quarter|fifth|tenth)s?${E}`, 'gu'), (m, f) => equivalentQ(m, f));
  take(new RegExp(`${B}(half|halved|twice|thrice|doubled|tripled|quadrupled|\\d+x|(?:two|three|four|five|ten|\\d+)fold)${E}`, 'gu'), (m, w) => equivalentQ(m, w));
  take(new RegExp(`${B}(?:double|triple)(?=\\s+(?:the|its|our|their|my)${E})`, 'gu'), (m) => equivalentQ(m, m));
  // Ranks: ranked second, first place, third-year.
  take(new RegExp(`${B}(?:ranked|placed|finished|came|took|won|earned|named)\\s+(?:in\\s+)?(?:the\\s+)?(${ORDINAL})${E}`, 'gu'), (m, o) => ordinalQ(m, o));
  take(new RegExp(`${B}(${ORDINAL})[\\s-]+(?:place|prize|overall|runner-up|year|in\\s+(?:my|the|our)\\s+class)${E}`, 'gu'), (m, o) => ordinalQ(m, o));
  // Digits and percentages.
  take(/\$?\d[\d,]*(?:\.\d+)?%?/g, (m) => ({ text: m, grounded: (own) => own.numbers.has(m.replace(/[$,%]/g, '')) || ownHasValue(own, Number(m.replace(/[$,%]/g, ''))) }));
  // Number words; "one" counts only before a unit ("one year", not "one of").
  take(new RegExp(`${B}(${NUMBER_WORD})${E}(\\s+(?:${UNIT})${E})?`, 'gu'), (m, w, unit) => {
    if (w === 'one' && !unit) return null;
    return { text: w, grounded: (own) => own.tokens.has(w) || ownHasValue(own, NUMBER_WORDS[w]) };
  });
  return out;
}

function equivalentQ(text, word) {
  const group = EQUIVALENTS.find((g) => g.includes(word)) ?? [word];
  return { text, grounded: (own) => group.some((g) => (/^[a-z ]+$/.test(g) ? wordIn(own.lower, g) : own.lower.includes(g))) };
}

function ordinalQ(text, o) {
  const n = ORDINALS[o] ?? Number.parseInt(o, 10);
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  const words = Object.keys(ORDINALS).filter((w) => ORDINALS[w] === n);
  return { text, grounded: (own) => [`${n}${suffix}`, ...words].some((w) => wordIn(own.lower, w)) };
}

// Words that mix Latin with another script, or are built only of look-alike Cyrillic or Greek letters.
function spoofedWords(text) {
  const out = [];
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const w = m[0];
    const latin = /\p{Script=Latin}/u.test(w);
    const other = /[^\p{Script=Latin}]/u.test(w);
    if ((latin && other) || (!latin && CONFUSABLE.test(w))) out.push(w);
  }
  return out;
}

const COMPANY_BEFORE = /(?:^|[^\p{L}\p{N}])(?:at|join|joining|to|for|from|dear)\s+(?:the\s+)?$/u;
const COMPANY_NEED_AFTER = /^\s+(?:uses?|needs?|relies\s+on|rely\s+on|seeks?|requires?|wants?|is\s+hiring|builds?|works?\s+(?:in|with|on))(?![\p{L}])/u;
const ROLE_AFTER = /^\s+(?:role|position|opening|internship|job|program|posting)(?![\p{L}])/u;
const WISH = '(?:would|\'d|hope|hoping|love|like|eager|excited|glad|keen|want|wanting|wish|chance|opportunity|ready|look\\s+forward)';

// True when the name at index in lower stands as a name in an allowed context.
function companyAllowed(lower, index, length) {
  const before = lower.slice(0, index);
  const after = lower.slice(index + length);
  if (COMPANY_BEFORE.test(before) || /^'s(?![\p{L}])/u.test(after)) return true;
  // The company as the subject of a needs verb at the start of a sentence or clause names only the company.
  return /(?:^|[,;]\s*|\band\s+)\s*$/.test(before) && COMPANY_NEED_AFTER.test(after);
}

function roleAllowed(lower, index, length) {
  const before = lower.slice(0, index);
  const after = lower.slice(index + length);
  if (/(?:^|[^\p{L}])the\s+$/u.test(before) && ROLE_AFTER.test(after)) return true;
  if (/(?:^|[^\p{L}])(?:apply|applying|applied|application)\s+(?:for|to)\s+(?:the\s+|an?\s+|this\s+|your\s+)?$/u.test(before)) return true;
  if (/(?:^|[^\p{L}])(?:apply|applying)\s+as\s+(?:an?\s+|the\s+)?$/u.test(before)) return true;
  return new RegExp(`(?:^|[^\\p{L}])${WISH}(?![\\p{L}])[^.;]{0,40}?\\bto\\s+(?:join|work|start|begin|serve|contribute|grow)(?:\\s+[\\p{L}\\p{N}&.'-]+){0,3}?\\s+as\\s+(?:an?\\s+|the\\s+)?$`, 'u').test(before);
}

// Masks each occurrence of name in sentence; returns the masked sentence and whether any occurrence stood outside its
// allowed contexts.
function maskName(sentence, name, allowed) {
  if (!name) return { masked: sentence, outside: false };
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'giu');
  let outside = false;
  const lower = sentence.toLowerCase();
  const masked = sentence.replace(re, (m, index) => {
    if (!allowed(lower, index, m.length)) outside = true;
    return ' '.repeat(m.length);
  });
  return { masked, outside };
}

// Runs of capitalized words after a sentence's first word; punctuation and run-break words end a run.
function organizationsIn(sentence) {
  const out = [];
  const words = sentence.trim().split(/\s+/);
  let run = [];
  const flush = () => {
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  words.forEach((raw, i) => {
    const w = raw.replace(/^[("'[]+/, '').replace(/(?:'s)?[)"',.;:!?\]]*$/, '');
    const first = i === 0 || (i === 1 && /^[("'[]+$/.test(words[0]));
    if (!first && /^\p{Lu}[\p{L}\p{N}&.+#-]*$/u.test(w) && !RUN_BREAK.has(w.toLowerCase())) run.push(w);
    else flush();
    if (/[,;:)"!?]$|[^.]\.$/.test(raw)) flush();
  });
  flush();
  return out;
}

// sources = { cv, answers, posting, company?, role?, extra? } where company and role (and extra, older callers) are the
// target names. Returns the unsupported items, empty when the draft passes.
export function check(text, sources = {}) {
  const own = ownIndex(norm([sources.cv, flatten(sources.answers)].join('\n')));
  const posting = norm(sources.posting).toLowerCase();
  const name = (v) => (typeof v === 'string' ? norm(v).trim() : '');
  const company = name(sources.company);
  const role = name(sources.role);
  const extras = [sources.extra].flat().map(name).filter(Boolean);

  const tech = SKILL_TERMS.filter((t) => !own.hasPhrase(t));
  const techTokens = new Set(tech.filter((t) => !/\s|-/.test(t)));
  const techPhrases = tech.filter((t) => /\s|-/.test(t));
  const risk = new Set();
  for (const { lower } of tokensOf(posting)) {
    if (/^\d/.test(lower) || NUMBER_WORDS[lower] !== undefined || ORDINALS[lower] !== undefined) continue;
    const forms = [...formsOf(lower)];
    if (forms.some((f) => own.forms.has(f) || COMMON_WORDS.has(f))) continue;
    risk.add(lower);
  }
  const isRisk = (lower) => techTokens.has(lower) || [...formsOf(lower)].some((f) => risk.has(f));

  const missing = new Map();
  const add = (item) => missing.set(item.toLowerCase(), missing.get(item.toLowerCase()) ?? item);
  for (const w of spoofedWords(norm(text))) add(w);
  for (const raw of sentencesOf(norm(text))) {
    let sentence = raw;
    for (const [n, allowed] of [[role, roleAllowed], [company, companyAllowed], ...extras.map((e) => [e, roleAllowed])]) {
      const { masked, outside } = maskName(sentence, n, allowed);
      if (outside && !own.hasPhrase(n)) add(n);
      sentence = masked;
    }
    for (const q of quantitiesIn(sentence)) if (!q.grounded(own)) add(q.text);
    const keyOf = phraseKey(sentence);
    for (const p of techPhrases) if (keyOf.includes(phraseKey(p))) add(p);
    // An unsupported organization is reported once, not again word by word.
    const inOrg = new Set();
    for (const org of organizationsIn(sentence)) {
      if (own.hasPhrase(org)) continue;
      add(org);
      for (const t of tokensOf(org)) inOrg.add(t.lower);
    }
    for (const t of tokensOf(sentence)) if (isRisk(t.lower) && !inOrg.has(t.lower)) add(t.text);
  }
  return [...missing.values()];
}
