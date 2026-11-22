// Invented-fact gate for drafted letters and messages, built to fail closed. A model can write a fluent line about a
// skill or a metric the student never had, and the posting is where most such lines come from, so the posting grounds
// nothing about the student. Checks, all whole-word (token or phrase boundary, never substring) after removing invisible
// characters and trademark signs, NFKC, digits of any script read as ASCII digits, and case folding:
// - Risk words: skill-like terms that cv.md and the answers lack: every known-tech term, every proper term of the posting
//   (capitalized inside a sentence, or opening a prose sentence, and not a common word), and every term in the posting's
//   requirement sections (Requirements, Qualifications, Skills, Preferred, You have, Nice to have ...) or in a sentence
//   with requirement wording (experience with, a plus, preferred). Generic narrative words of the posting (inventory,
//   campaigns, clinicians) are not risk words. A risk word anywhere in the letter is flagged, whatever the subject, clause
//   or sentence ("Your team uses Tableau" is flagged when the cv lacks Tableau). A posting word on the common-word list is
//   not a risk word unless it is known tech, or unless the posting capitalizes it mid-sentence in a form that is not itself
//   common (Looker, Planner, Teams): such a word is flagged wherever the letter capitalizes it. camelCase and joined tool
//   names (PowerBI, dbtCloud) are split.
// - The company name and role title pass only as names in fixed contexts (at/join/to/for/from <Company>,
//   <Company>'s, Dear <Company>, <Company> uses/needs/relies on ..., the <role> role/position/opening, apply for the
//   <role>, a wish to join, work or bring something as the <role>); anywhere else they must be in cv.md or the answers.
//   A first-person experience claim (I worked/interned/was/know/use ...) turns those contexts off unless an apply, join
//   or wish word stands between the claim and the name, so "I interned at Acme" and "I held the <role> position" need
//   the cv.
// - Quantities (digits, number words, fractions, multipliers in any inflection, durations, ranks, ordinals, ranges)
//   must appear in cv.md or the answers as the same expression or its numeric equivalent.
// - A run of capitalized words inside a sentence (an organization) must appear in cv.md or the answers. The first word
//   of a sentence counts as a name too unless its lowercase form is a common word ("Google hired me" is checked, "Last
//   summer" is not).
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

// Known-tech terms written with a slash, which tokens split into single letters (A/B, CI/CD); matched as written.
const SLASH_TERMS = Object.freeze(['a/b', 'ci/cd'].map((t) => ({ text: t.toUpperCase(), re: new RegExp(`(?<![\\p{L}\\p{N}])${t.replace('/', '\\s*/\\s*')}(?![\\p{L}\\p{N}])`, 'iu') })));

// Known-tech terms that are also plain English words ("I'd go further", "a spark of interest", "I excel at"). They count as
// tech only in tech casing (Go, React, R; a capital counts even at a sentence's start, so the check fails closed) or
// within two words of a tech context word (go code, services in go, components with react, node.js).
const AMBIGUOUS_TECH = new Set(['go', 'r', 'rust', 'swift', 'spark', 'react', 'epic', 'node', 'excel', 'sap', 'ruby', 'rails', 'flask', 'julia', 'angular']);
const TECH_CONTEXT = new Set(['lang', 'language', 'languages', 'code', 'coding', 'service', 'services', 'framework', 'frameworks', 'programming', 'script', 'scripts', 'scripting', 'developer', 'developers', 'library', 'libraries', 'js', 'app', 'apps', 'component', 'components', 'backend', 'frontend', 'api', 'apis', 'server', 'servers', 'codebase']);

// True when an ambiguous term at token index i of the sentence's tokens is written as tech.
function usedAsTech(tokens, i, sentence) {
  const t = tokens[i];
  for (const d of [-2, -1, 1, 2]) if (TECH_CONTEXT.has(tokens[i + d]?.lower)) return true;
  if (sentence.slice(t.index + t.text.length).startsWith('.js')) return true;
  return /^\p{Lu}/u.test(t.text);
}

// Words that open a sentence or a letter, or name a day or month, and break a run of capitalized words.
const RUN_BREAK = new Set(
  "i i'm i've i'd i'll dear hello hi hiring manager managers team sincerely regards best thank thanks yours monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(' '),
);

const flatten = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? Object.values(v).map(flatten).join(' ') : String(v));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Invisible characters (soft hyphen, zero-width space and joiners, word joiner, BOM and the other default-ignorable
// code points) split a word without showing; they are removed before anything is read.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
export const stripInvisible = (s) => String(s ?? '').replace(INVISIBLE, '');
// Trademark, registered and copyright signs are dropped; NFKC would turn them into letters (Tableau(TM) -> TableauTM).
const MARKS = /[\u2122\u00ae\u00a9\u2120]/g;
// A decimal digit of any script becomes its ASCII digit. Unicode keeps each script's digits as one run starting at zero.
function asciiDigit(d) {
  if (d >= '0' && d <= '9') return d;
  let zero = d.codePointAt(0);
  while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return String((d.codePointAt(0) - zero) % 10);
}
const norm = (s) => stripInvisible(s).replace(MARKS, '').normalize('NFKC').replace(/\p{Nd}/gu, asciiDigit).replace(/[\u2018\u2019\u02bc]/g, "'");

// Tokens: letters and digits, with a trailing ++ or # kept (c++, c#); hyphens, dots and apostrophes split.
const TOKEN_RE = /[\p{L}\p{N}]+(?:\+\+|#)?/gu;
const tokensOf = (s) => [...String(s).matchAll(TOKEN_RE)].map((m) => ({ text: m[0], lower: m[0].toLowerCase(), index: m.index }));
const phraseKey = (s) => ` ${tokensOf(s.toLowerCase()).map((t) => t.lower).join(' ')} `;

// Inflected forms reduced to candidate base forms (reports -> report, forecasting -> forecast, findings -> find, used and
// using -> use, doing -> do).
function formsOf(w) {
  const out = new Set([w]);
  const add = (s) => s.length >= 2 && out.add(s);
  const strip = (v) => {
    if (v.endsWith('ies')) add(`${v.slice(0, -3)}y`);
    if (v.endsWith('es')) add(v.slice(0, -2));
    if (v.endsWith('s') && !v.endsWith('ss')) add(v.slice(0, -1));
    for (const suf of ['ing', 'ed', 'er', 'est']) {
      if (v.length >= suf.length + 2 && v.endsWith(suf)) {
        const stem = v.slice(0, -suf.length);
        add(stem);
        add(`${stem}e`);
        if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
        if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
      }
    }
    if (v.endsWith('ly') && v.length > 5) add(v.slice(0, -2));
  };
  strip(w);
  for (const v of [...out]) if (v !== w) strip(v);
  return out;
}
const isCommon = (lower) => [...formsOf(lower)].some((f) => COMMON_WORDS.has(f));

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
const TIME_UNIT = 'years?|yrs|months?|semesters?|terms?|quarters?|summers?|weeks?|days?|hours?';
// True when the own text gives the value n with the same time unit (3 years, three years, 3-year).
function timeGrounded(own, n, unit) {
  const base = unit === 'yrs' ? 'year' : unit.replace(/s$/, '');
  const values = [n, ...Object.keys(NUMBER_WORDS).filter((w) => NUMBER_WORDS[w] === n)].map(String).map(escapeRe).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${values})\\+?[\\s-]+(?:${base}s?${base === 'year' ? '|yrs' : ''})(?![\\p{L}\\p{N}])`, 'u').test(own.lower);
}
const UNIT = 'years?|yrs|months?|semesters?|terms?|quarters?|summers?|weeks?|days?|hours?|projects?|dashboards?|reports?|teams?|people|clients?|customers?|users?|students?|members?|apps?|tools?|models?|courses?|classes?|internships?|jobs?|roles?|awards?|times';
// Equivalent spellings of fractions and multipliers, as regex sources; the verbs match in every inflection.
const EQUIVALENTS = [
  'half|halve[sd]?|halving|1/2|50%',
  'third|1/3|33%',
  'quarter|1/4|25%',
  'twice|doubl(?:e[sd]?|ing)|2x|two times|2 times|twofold',
  'thrice|tripl(?:e[sd]?|ing)|3x|three times|3 times|threefold',
  'quadrupl(?:e[sd]?|ing)|4x|four times|4 times|fourfold',
  'number one|no\\.\\s*1|#\\s*1',
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

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const wordIn = (lower, w) => new RegExp(`${B}${escapeRe(w)}${E}`, 'u').test(lower);

// True when the own text says the value n with a word or digits (3, three).
function ownHasValue(own, n) {
  if (n === null || n === undefined) return false;
  if (own.numbers.has(String(n))) return true;
  return Object.entries(NUMBER_WORDS).some(([w, v]) => v === n && own.tokens.has(w));
}

// Ordinal uses that say nothing about the student: "at first", "First, ...", "my first choice", "for the first time".
const ORDINAL_NOT_CLAIM = new RegExp(
  `${B}(?:at\\s+first|first\\s+of\\s+all|first\\s+and\\s+foremost|first[\\s-]?hand|(?:my|our|your)?\\s*first\\s+choice|first\\s+steps?|(?:for\\s+)?the\\s+first\\s+time|in\\s+the\\s+first\\s+place|^\\s*one\\s+day(?=\\s*,?\\s+(?:i|we)(?![\\p{L}]))|second\\s+(?:look|opinion|nature))${E}|^\\s*(?:first|second|third|fourth|fifth)(?=\\s*,)`,
  'gu',
);
// Outreach only (check option `outreach`): an ordinal about the reader in a question ("What was your first year
// like?") and "send/share ... first" at the end of a sentence ("should I send over my CV first?") make no claim.
const READER_ORDINAL = new RegExp(`${B}your\\s+(?:very\\s+)?(?:${ORDINAL})(?:[\\s-]+(?:year|month|week|day|job|role|internship|project|time))?${E}`, 'gu');
const SEND_FIRST = new RegExp(`${B}(?:send|share)${E}[^.!?]{0,40}?\\s+first(?=\\s*[.!?]*\\s*$)`, 'gu');

// Quantity expressions in a masked sentence, each { text, grounded(own) }. Matched spans are blanked so a later pattern
// never reports the same words twice.
function quantitiesIn(sentence, { outreach = false } = {}) {
  let s = sentence.toLowerCase();
  const out = [];
  const take = (re, make) => {
    s = s.replace(re, (...m) => {
      const q = make(...m);
      if (q) out.push(q);
      return ' '.repeat(m[0].length);
    });
  };
  const durationQ = (text, n, unit) => ({
    text,
    grounded: (own) => wordIn(own.lower, text) || new RegExp(`${B}(?:${n === 1 ? 'a|an|one|1' : [n, ...Object.keys(NUMBER_WORDS).filter((w) => NUMBER_WORDS[w] === n)].join('|')})[\\s-]+${unit}s?${E}`, 'u').test(own.lower),
  });
  if (outreach) {
    if (/\?\s*$/.test(s)) take(READER_ORDINAL, () => null);
    take(SEND_FIRST, () => null);
  }
  take(ORDINAL_NOT_CLAIM, () => null);
  // Ranges: 2-3 years, 2 to 3. A time unit after the range is part of it (reported as the numbers only).
  take(new RegExp(`${B}(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:-|\\u2013|to)\\s*(\\d[\\d,]*(?:\\.\\d+)?)${E}(?:\\s+(?:${TIME_UNIT})${E})?`, 'gu'), (m, a, b) => ({
    text: m.replace(/\s+\p{L}+$/u, '').trim(),
    grounded: (own) => new RegExp(`${B}${escapeRe(a)}\\s*(?:-|\\u2013|to)\\s*${escapeRe(b)}${E}`, 'u').test(own.lower),
  }));
  // Rank claims: top tenth, top 5%, top three, number one, no. 1.
  take(new RegExp(`${B}top\\s+((?:\\d[\\d,]*(?:\\.\\d+)?%?)|${NUMBER_WORD}|${ORDINAL}|half|thirds?|quarters?|fifths?|tenths?)${E}`, 'gu'), (m, inner) => ({
    text: m,
    grounded: (own) => wordIn(own.lower, m) || quantitiesIn(inner).every((q) => q.grounded(own)),
  }));
  take(new RegExp(`${B}(?:number\\s+one|no\\.\\s*1)${E}|#\\s*1${E}`, 'gu'), (m) => equivalentQ(m));
  take(new RegExp(`${B}half\\s+a\\s+decade${E}`, 'gu'), (m) => durationQ(m, 5, 'year'));
  take(new RegExp(`${B}(?:a|an|one)\\s+(year|month|semester)\\s+and\\s+a\\s+half${E}`, 'gu'), (m) => ({ text: m, grounded: (own) => wordIn(own.lower, m) }));
  take(new RegExp(`${B}(?:a|an|one|1)\\s+decade${E}|${B}decades?${E}`, 'gu'), (m) => (/^decades$/.test(m) ? { text: m, grounded: (own) => wordIn(own.lower, m) } : durationQ(m, 10, 'year')));
  take(new RegExp(`${B}(?:a|an|one)\\s+(year|month|semester|quarter|term|week)${E}`, 'gu'), (m, unit) => durationQ(m, 1, unit));
  take(new RegExp(`${B}(?:a|an)\\s+(day|hour|fortnight)${E}(?!-to-)`, 'gu'), (m, unit) => durationQ(m, 1, unit));
  // Fractions and multipliers; double/triple/quadruple/halve count in every inflection and position, except the
  // non-quantity phrases double-check, double click and double major.
  take(new RegExp(`${B}(?:(?:a|one|by\\s+a|by\\s+one|two)\\s+)(third|quarter|fifth|tenth)s?${E}`, 'gu'), (m) => equivalentQ(m));
  take(new RegExp(`${B}(?:(?:double|triple)[\\s-]+(?:check|checks|checked|checking|click|clicks|clicked|clicking|majors?|majored|majoring))${E}`, 'gu'), () => null);
  take(new RegExp(`${B}(half|halve[sd]?|halving|twice|thrice|doubl(?:e[sd]?|ing)|tripl(?:e[sd]?|ing)|quadrupl(?:e[sd]?|ing)|\\d+x|(?:two|three|four|five|ten|\\d+)fold)${E}`, 'gu'), (m) => equivalentQ(m));
  // Ranks: ranked second, first place, third-year.
  take(new RegExp(`${B}(?:ranked|placed|finished|came|took|won|earned|named)\\s+(?:in\\s+)?(?:the\\s+)?(${ORDINAL})${E}`, 'gu'), (m, o) => ordinalQ(m, o));
  take(new RegExp(`${B}(${ORDINAL})[\\s-]+(?:place|prize|overall|runner-up|year|in\\s+(?:my|the|our)\\s+class)${E}`, 'gu'), (m, o) => ordinalQ(m, o));
  // Any other ordinal is a claim (the first intern to ship, the very first analyst).
  take(new RegExp(`${B}(${ORDINAL})${E}`, 'gu'), (m, o) => ordinalQ(m, o));
  // Digits and percentages. A number before a time unit is grounded only by the same number of the same unit (3 years
  // is not grounded by 3 teams).
  take(new RegExp(`\\$?\\d[\\d,]*(?:\\.\\d+)?%?(?:[\\s-]+(${TIME_UNIT})${E})?`, 'gu'), (m, unit) => {
    const text = m.replace(/[\s-]+\p{L}+$/u, '');
    const n = text.replace(/[$,%]/g, '');
    if (unit) return { text, grounded: (own) => timeGrounded(own, Number(n), unit) };
    return { text, grounded: (own) => own.numbers.has(n) || ownHasValue(own, Number(n)) };
  });
  // Number words; "one" counts only before a unit ("one year", not "one of").
  take(new RegExp(`${B}(${NUMBER_WORD})${E}(\\s+(?:${UNIT})${E})?`, 'gu'), (m, w, unit) => {
    if (w === 'one' && !unit) return null;
    const timeUnit = unit && new RegExp(`^\\s+(${TIME_UNIT})$`, 'u').exec(unit)?.[1];
    if (timeUnit && NUMBER_WORDS[w] !== null) return { text: w, grounded: (own) => timeGrounded(own, NUMBER_WORDS[w], timeUnit) };
    return { text: w, grounded: (own) => own.tokens.has(w) || ownHasValue(own, NUMBER_WORDS[w]) };
  });
  // A count of years with no number (years of, several years of, for years, spent years, several years' experience,
  // years working with) needs the phrase or a span of two or more years in the cv; every form but "years of" counts only
  // in a first-person sentence.
  const firstPerson = FIRST_PERSON.test(s);
  const vague = '(?:several|many|a\\s+few|few|multiple|numerous|countless|some)\\s+';
  take(new RegExp(`${B}(?:${vague})?years(?:\\s+of|'\\s+experience|\\s+(?:experience|working|building|using|writing|doing|in|with))${E}|${B}(?:for|spent)\\s+(?:${vague})?years${E}`, 'gu'), (m) => (!/^(?:\S+\s+)*years\s+of$/.test(m) && !firstPerson ? null : {
    text: m,
    grounded: (own) => wordIn(own.lower, m) || new RegExp(`${B}(?:[2-9]|\\d\\d+|two|three|four|five|six|seven|eight|nine|ten|several|many)\\+?[\\s-]+(?:years|yrs)${E}`, 'u').test(own.lower),
  }));
  return out;
}

// A fraction or multiplier grounded by any equivalent spelling in the own text.
function equivalentQ(text) {
  const key = text.replace(/^(?:a|one|by\s+a|by\s+one|two)\s+/, '').replace(/s$/, '');
  const group = EQUIVALENTS.find((g) => new RegExp(`^(?:${g})$`, 'u').test(key) || new RegExp(`^(?:${g})$`, 'u').test(text)) ?? escapeRe(text);
  return { text, grounded: (own) => new RegExp(`${B}(?:${group})${E}`, 'u').test(own.lower) || wordIn(own.lower, text) };
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

// First-person experience claims: I worked / interned / was / know / use ..., with optional adverbs between.
const CLAIM_ADVERB = 'have|has|had|already|also|currently|still|recently|previously|once|regularly|often|now|just|even|been|personally|actually|both|all|then|later|first|proudly';
const CLAIM_VERB = 'am|are|was|were|been|know|knows|use|uses|write|writes|build|builds|work|works|run|runs|lead|leads|manage|manages|own|owns|maintain|maintains|teach|teaches|intern|interns|hold|holds|serve|serves|code|develop|develops|support|supports|analyze|analyse|built|wrote|written|led|ran|made|took|taken|got|won|spent|sent|kept|brought|gave|knew|known|met|began|begun|grew|drove|found|sold|paid|set|put|cut|became|came|went|left|taught|held|did|done|had|saw|seen|fed|bought|caught|dealt|rode|spoke|stood|understood|sat|wore';
const CLAIM_RE = new RegExp(`(?<![\\p{L}'])(?:i|we)(?:'m|'re|(?:'ve|'d)?(?:\\s+(?:${CLAIM_ADVERB}))*\\s+(?:${CLAIM_VERB}|\\p{L}*[a-df-z]ed))(?![\\p{L}])`, 'gu');
// Apply, join and wish words: after one of these the name is the target, not a past employer or a tool.
const FRAME_RE = /(?<![\p{L}])(?:apply|applying|applied|application|join|joining|interview\p{L}*|would|'d|could|can|will|hope\p{L}*|lov\p{L}*|like|eager|excit\p{L}*|glad|keen|want\p{L}*|wish\p{L}*|chance|opportunity|ready|forward|interest\p{L}*|inspir\p{L}*|impress\p{L}*|drawn|attract\p{L}*|admir\p{L}*|thrill\p{L}*|delight\p{L}*|plan|planning|aim|aiming|seek|seeking)(?![\p{L}])/gu;
// Clause breaks after the name.
const CLAUSE_BREAK = /(?<![\p{L}])(?:and|but|because|so|while|since|although|though|where|who|which|when)(?![\p{L}])|[;]/u;
// A where/who clause right after the name or its short noun phrase belongs to the name ("Acme, where I interned",
// "Acme's analytics team, where I volunteered"); its text runs to the next comma or semicolon.
const RELATIVE_AFTER = /^(?:'s)?(?:\s+[\p{L}-]+){0,3}?\s*,?\s+(?:where|who)(?![\p{L}])([^,;]*)/u;
// Clause breaks for the claim scope of posting bullet terms.
const CLAIM_CLAUSE_BREAK = /[,;]|(?<![\p{L}])(?:and|but|because|so|while)(?![\p{L}])/u;
// The company as employer of the writer: hired me, trained me, paid me.
const EMPLOYED_ME = /(?<![\p{L}])(?:hired|employed|trained|mentored|paid|promoted|recruited|onboarded|supervised)\s+(?:me|us)(?![\p{L}])/u;
const MY_WORK_AT = /(?<![\p{L}])my\s+(?:[\p{L}-]+\s+)?(?:internship|job|work|role|time|summer|position|experience|manager|employer|team|supervisor|boss|colleagues|coworkers)\s+(?:at|with|for|from)\s+(?:the\s+)?$/u;

const lastEnd = (re, s) => {
  let end = -1;
  for (const m of s.matchAll(re)) end = m.index + m[0].length;
  return end;
};

// True when the name at index stands in a first-person experience claim with no apply, join or wish word between the
// claim and the name ("I interned at Acme", "At Acme, I built ...", "I held the <role> position").
function experienceClaim(lower, index, length) {
  const before = lower.slice(0, index);
  if (MY_WORK_AT.test(before)) return true;
  // The adjacent relative clause counts even after an apply or wish word; a wish inside it ("where I could grow") ends it.
  const relative = RELATIVE_AFTER.exec(lower.slice(index + length))?.[1].split(FRAME_RE)[0];
  if (relative && (lastEnd(CLAIM_RE, relative) >= 0 || EMPLOYED_ME.test(relative))) return true;
  const claimEnd = lastEnd(CLAIM_RE, before);
  if (lastEnd(FRAME_RE, before) > claimEnd) return false;
  if (claimEnd >= 0) return true;
  const clause = lower.slice(index + length).split(CLAUSE_BREAK)[0];
  return lastEnd(CLAIM_RE, clause) >= 0 || EMPLOYED_ME.test(clause);
}

const COMPANY_BEFORE = /(?:^|[^\p{L}\p{N}])(?:at|join|joining|to|for|from)\s+(?:the\s+)?$/u;
const COMPANY_NEED_AFTER = /^\s+(?:uses?|needs?|relies\s+on|rely\s+on|seeks?|requires?|wants?|is\s+hiring|builds?|works?\s+(?:in|with|on))(?![\p{L}])/u;
const ROLE_AFTER = /^\s+(?:role|position|opening|internship|job|program|posting)(?![\p{L}])/u;
const WISH = '(?:would|could|will|\'d|hope|hoping|love|like|eager|excited|glad|keen|want|wanting|wish|chance|opportunity|ready|look\\s+forward)';
const WISH_VERB = '(?:join|work|start|begin|serve|contribute|grow|bring|help|support|do|be|become|learn)';
// A wish ends at a semicolon, since, because or but, and at a comma or "and" whose segment holds a real claim ("and last
// summer I worked as", "building on my summer as"). Empty segments (an Oxford comma) and segments with no claim ("my
// SQL, Excel, and Python skills to Acme as", "and grow as", "growing as an analyst") do not end it.
const WISH_HARD_BREAK = /;|(?<![\p{L}])(?:since|because|but)(?![\p{L}])/u;
const WISH_SOFT_BREAK = /,|(?<![\p{L}])and(?![\p{L}])/u;
function wishTail(before) {
  const parts = before.split(WISH_HARD_BREAK).at(-1).split(WISH_SOFT_BREAK).filter((p, k, all) => k === all.length - 1 || /\p{L}/u.test(p));
  const ends = (p) => lastEnd(CLAIM_RE, p) >= 0 || /(?<![\p{L}])my\s+(?:[\p{L}-]+\s+){0,2}?(?:summer|time|internship|job|role|work|year|years)\s+as(?![\p{L}])/u.test(p);
  let i = parts.length - 1;
  while (i > 0 && !ends(parts[i])) i -= 1;
  return parts.slice(i).join(' ');
}
// "continue to work as", "keep working as", "return as" say the role is already held.
const ROLE_HELD = /(?<![\p{L}])(?:continu\p{L}*|keep\p{L}*|remain\p{L}*|return\p{L}*|resum\p{L}*|still|again|stay\p{L}*|back)(?![\p{L}])/u;

// True when the name at index in lower stands as a name in an allowed context.
function companyAllowed(lower, index, length) {
  const before = lower.slice(0, index);
  const after = lower.slice(index + length);
  if (/(?:^|[^\p{L}\p{N}])dear\s+(?:the\s+)?$/u.test(before)) return true;
  // "Returning to Acme", "back at Acme": the company was already the employer.
  if (/(?:^|[^\p{L}])(?:return\p{L}*|rejoin\p{L}*|back|again)\s+(?:to\s+|at\s+|with\s+)?(?:the\s+)?$/u.test(before)) return false;
  // The company as the subject of a needs verb at the start of a sentence or clause names only the company.
  if (/(?:^|[,;]\s*|\band\s+)\s*$/.test(before) && COMPANY_NEED_AFTER.test(after)) return true;
  if (!COMPANY_BEFORE.test(before) && !/^'s(?![\p{L}])/u.test(after)) return false;
  return !experienceClaim(lower, index, length);
}

function roleAllowed(lower, index, length) {
  const before = lower.slice(0, index);
  const after = lower.slice(index + length);
  if (/(?:^|[^\p{L}])the\s+$/u.test(before) && ROLE_AFTER.test(after)) return !experienceClaim(lower, index, length);
  if (/(?:^|[^\p{L}])(?:apply|applying|applied|application)\s+(?:for|to)\s+(?:the\s+|an?\s+|this\s+|your\s+)?$/u.test(before)) return true;
  if (/(?:^|[^\p{L}])(?:apply|applying)\s+as\s+(?:an?\s+|the\s+)?$/u.test(before)) return true;
  const tail = wishTail(before);
  const wish = new RegExp(`(?:^|[^\\p{L}])${WISH}(?![\\p{L}])[^.;]{0,40}?(?:\\bto\\s+)?${WISH_VERB}(?![\\p{L}])[^.;]{0,80}?\\s+as\\s+(?:an?\\s+|the\\s+|your\\s+)?$`, 'u').exec(tail);
  return Boolean(wish) && !ROLE_HELD.test(wish[0]);
}

// Job-title nouns. After "as a/an/the/their" in a first-person sentence, "served/worked/interned/was hired as", "worked at
// <Company> as", "my role/title/position was" or "in my role as", "I am/was a/an" or "I was the" (not before an ordinal:
// "I was the very first analyst" is a quantity), and before internship/job/position/role in "my <title> internship", a
// phrase ending in one of these (with its modifiers) is a title the cv must hold.
const TITLE_NOUN = /^(?:analyst|engineer|developer|lead|manager|intern|associate|coordinator|specialist|scientist|consultant|assistant|director|administrator|designer|architect|technician|officer|supervisor|researcher|representative|programmer|strategist|trainee|apprentice|advisor|adviser|accountant|auditor|executive)s?$/;
const TITLE_TRIGGER = new RegExp(`(?<![\\p{L}'])(?:(?:(?:served|serve|serving|worked|working|interned|interning|employed|hired(?:\\s+me)?|started|joined|promoted)(?:\\s+(?:at|for|with)\\s+[^,.;]{1,60}?)?\\s+as|(?:my|the)\\s+(?:job\\s+)?(?:role|title|position|job)\\s+(?:was|is|as))(?:\\s+(?:a|an|the|my|their|its|his|her|our))?|as\\s+(?:a|an|the|their|its|his|her|our)|i\\s+was\\s+the(?!\\s+(?:\\p{L}+\\s+)?(?:${ORDINAL})(?![\\p{L}\\p{N}]))|(?:i\\s+(?:am|was)|i'm)\\s+(?:currently\\s+|also\\s+|now\\s+)?(?:a|an))\\s+`, 'gu');
const MY_TITLE_JOB = /(?<![\p{L}'])my\s+((?:[\p{L}-]+\s+){1,4})(?=(?:internship|job|position|role)(?![\p{L}]))/gu;
const FIRST_PERSON = /(?<![\p{L}'])(?:i|i'm|i've|i'd|me|my|we|our|us)(?![\p{L}])/u;
const TITLE_STOP = new Set('at for of in on with to from and or but who where which that during last this since when while because so i we my our by under'.split(' '));
// Leading modifiers that say nothing about the title itself (a summer intern is an intern).
const TITLE_FILLER = new Set(['summer', 'former', 'recent', 'new', 'current', 'part', 'full', 'time', 'temporary', 'seasonal', 'remote', 'unpaid', 'paid']);
// A wish, not a claim: an aspiring or future analyst.
const TITLE_WISH = new Set(['aspiring', 'future', 'prospective', 'budding', 'would', 'hiring']);
// "As an intern on your team, I would ...": a title before your team or the masked company in a wish sentence is the
// target role.
const TARGET_AFTER = /^\s+(?:on|at|with|for|in|to|joining)\s+(?:your(?![\p{L}])|\s{2,})/u;
const TEAM_LED = /(?<![\p{L}])(?:i|we)\s+(?:\p{L}+ly\s+)?(led|managed|supervised|headed|ran|coordinated)\s+(?:(?:a|the|my|our)\s+)?(?:[\p{L}-]+\s+){0,2}?(?:team|group|crew|squad|staff)s?(?![\p{L}])/u;

// Title claims in a masked sentence the own text does not hold, as written in the letter.
function titleClaims(sentence, own) {
  const lower = sentence.toLowerCase();
  const out = [];
  if (!FIRST_PERSON.test(lower)) return out;
  const spans = [
    ...[...lower.matchAll(TITLE_TRIGGER)].map((m) => [m.index + m[0].length, sentence.length]),
    ...[...lower.matchAll(MY_TITLE_JOB)].map((m) => [m.index + m[0].length - m[1].length, m.index + m[0].length]),
  ];
  for (const [start, end] of spans) {
    const rest = sentence.slice(start, end).split(/[,.;:!?()"]/)[0];
    const toks = [];
    for (const t of tokensOf(rest)) {
      if (TITLE_STOP.has(t.lower) || toks.length >= 6) break;
      toks.push(t);
    }
    let last = -1;
    toks.forEach((t, i) => { if (TITLE_NOUN.test(t.lower)) last = i; });
    if (last < 0) continue;
    let phrase = toks.slice(0, last + 1);
    if (phrase.some((t) => TITLE_WISH.has(t.lower))) continue;
    while (phrase.length > 1 && TITLE_FILLER.has(phrase[0].lower)) phrase = phrase.slice(1);
    const at = start + phrase[0].index;
    const text = sentence.slice(at, start + phrase.at(-1).index + phrase.at(-1).text.length);
    if (roleAllowed(lower, at, text.length)) continue;
    if (TARGET_AFTER.test(lower.slice(at + text.length)) && lastEnd(FRAME_RE, lower) >= 0) continue;
    const key = phrase.map((t) => t.lower).join(' ');
    if (own.hasPhrase(key) || own.hasPhrase(key.replace(/s$/, '')) || own.hasPhrase(`${key}s`)) continue;
    out.push(text);
  }
  const team = TEAM_LED.exec(lower);
  if (team && !new RegExp(`${B}${team[1]}${E}[^.;\\n]{0,40}${B}(?:team|group|crew|squad|staff)`, 'u').test(own.lower)) out.push(sentence.slice(team.index, team.index + team[0].length).replace(/^(?:i|we)\s+/i, ''));
  return out;
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

// Runs of capitalized words; punctuation and run-break words end a run. The sentence's first word starts a run only
// when isName says so (its lowercase form is not a common word).
function organizationsIn(sentence, isName) {
  const out = [];
  const words = sentence.trim().split(/\s+/);
  const firstAt = words.findIndex((raw) => /[\p{L}\p{N}]/u.test(raw));
  let run = [];
  const flush = () => {
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  words.forEach((raw, i) => {
    const w = raw.replace(/^[("'[]+/, '').replace(/(?:'s)?[)"',.;:!?\]]*$/, '');
    const capital = /^\p{Lu}[\p{L}\p{N}&.+#-]*$/u.test(w) && !RUN_BREAK.has(w.toLowerCase());
    if (capital && (i !== firstAt || isName(w))) run.push(w);
    else flush();
    if (/[,;:)"!?]$|[^.]\.$/.test(raw)) flush();
  });
  flush();
  return out;
}

// Inserts a space at camelCase joins (PowerBI -> Power BI, dbtCloud -> dbt Cloud) in every token keep() rejects.
const splitCamel = (s, keep) => s.replace(TOKEN_RE, (t) => (keep(t.toLowerCase()) ? t : t.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')));
// Words that may follow a tool name inside one joined token (dbtcloud, snowflakedb).
const COMPOUND_REST = new Set(['db', 'cloud', 'server', 'desktop', 'online', 'studio', 'pro', 'core', 'lake', 'hub', 'sql', 'ql', 'js']);

// Requirement section headers in any case, with markdown marks and a trailing colon stripped (Requirements, Job
// Requirements, Minimum Qualifications, Technical Skills, Must have, Nice to have, What you bring, Who we're looking for,
// Your profile, The ideal candidate ...) and requirement wording in any sentence (experience with, a plus, preferred).
const REQ_HEADER = /^(?:the\s+)?(?:(?:basic|minimum|required|preferred|desired|key|bonus|additional|technical|job|position|candidate|your|ideal)\s+)*(?:requirements?|qualifications?|skills?(?:\s+(?:and|&)\s+(?:experience|qualifications?|abilities))?|experience|preferred|nice[\s-]+to[\s-]+haves?|must[\s-]+haves?|bonus(?:\s+points)?|education|profile|candidate|(?:what\s+)?you(?:'ll)?\s+(?:have|bring|need|might\s+be\s+a\s+fit\s+if\s+you)|what\s+(?:we(?:'re|\s+are)?\s+)?look(?:ing)?\s+for|who\s+(?:you\s+are|we(?:'re|\s+are)\s+looking\s+for)|about\s+you|you\s+might\s+be\s+a\s+fit(?:\s+if\s+you)?)(?![\p{L}])/iu;
const REQ_WORDING = /(?<![\p{L}])(?:experience\s+(?:with|in|using)|familiar(?:ity)?\s+with|proficien\p{L}*|knowledge\s+of|a\s+plus|preferred|required|nice\s+to\s+have|must\s+have|certificat\p{L}*)(?![\p{L}])/iu;
const BULLET = /^\s*(?:[-*\u2022\u25cf\u25aa\u25e6\u2013\u2014]|\d+[.)])\s+/u;

// The posting's sentences, each { text, requirement, bulletLead }: requirement when it stands in a requirement section
// (from its header to the next header or to the first prose line after the section's bullets) or uses requirement
// wording; bullet when it stands on a bullet line; bulletLead when it opens one.
function postingSentences(postingText) {
  const out = [];
  let inReq = false;
  let bullets = false;
  for (const rawLine of postingText.split(/\n+/)) {
    const bullet = BULLET.test(rawLine);
    let line = rawLine.replace(BULLET, '').trim();
    if (!line) continue;
    // A markdown header (## Requirements, **Requirements:**) is read without its marks; any short one starts a section.
    const plain = line.replace(/^[#*_\s]+/, '').replace(/[*_\s]+$/, '');
    const header = bullet ? null : /^([^:.!?]{1,60}):\s*(.*)$/.exec(plain);
    if (header && header[1].trim().split(/\s+/).length <= 8) {
      inReq = REQ_HEADER.test(header[1].trim());
      bullets = false;
      line = header[2];
    } else if (!bullet && plain.split(/\s+/).length <= 6 && !/[.!?]$/.test(plain) && (plain !== line || REQ_HEADER.test(plain))) {
      inReq = REQ_HEADER.test(plain);
      bullets = false;
      if (inReq) continue;
    } else if (bullet) bullets = true;
    else if (inReq && bullets) inReq = false;
    sentencesOf(line).forEach((text, k) => out.push({ text, requirement: inReq || REQ_WORDING.test(text), bullet, bulletLead: bullet && k === 0 }));
  }
  return out;
}

// sources = { cv, answers, posting, company?, role?, extra? } where company and role (and extra, older callers) are the
// target names, and acronyms? lists acronyms the caller found grounded: a run of capitalized words that joins one with
// other grounded words ("Data Structures TA") passes when each part is grounded. outreach? (true only from
// scripts/outreach-drafts.mjs) adds the READER_ORDINAL and SEND_FIRST exemptions; cover letters and fill plans never
// pass it. Returns the unsupported items, empty when the draft passes.
export function check(text, sources = {}) {
  const ownText = norm([sources.cv, flatten(sources.answers)].join('\n'));
  const own = ownIndex(ownText);
  const ownCased = new Set(tokensOf(ownText).map((t) => t.text));
  const postingText = norm(sources.posting);
  const posting = postingText.toLowerCase();
  const name = (v) => (typeof v === 'string' ? norm(v).trim() : '');
  const company = name(sources.company);
  const role = name(sources.role);
  const extras = [sources.extra].flat().map(name).filter(Boolean);
  const acronyms = new Set([sources.acronyms].flat().map(name).filter(Boolean));
  // A run holding a grounded acronym is split there; the acronym and each part around it must be grounded.
  const groundedAround = (org) => {
    const words = org.split(/\s+/);
    if (!words.some((w) => acronyms.has(w))) return false;
    const parts = [];
    let part = [];
    for (const w of words) {
      if (!acronyms.has(w)) part.push(w);
      else {
        parts.push(part.join(' '), w);
        part = [];
      }
    }
    parts.push(part.join(' '));
    return parts.filter(Boolean).every((p) => own.hasPhrase(p));
  };

  const tech = SKILL_TERMS.filter((t) => !own.hasPhrase(t));
  const techTokens = new Set(tech.filter((t) => !/\s|-/.test(t)));
  const techPhrases = tech.filter((t) => /\s|-/.test(t));
  // Joined spellings of tool phrases (powerbi, scikitlearn) are tool tokens too.
  for (const p of techPhrases) techTokens.add(p.replace(/[\s-]+/g, ''));
  const allTechTokens = new Set(SKILL_TERMS.filter((t) => !/\s|-/.test(t)));
  const keepWhole = (lower) => allTechTokens.has(lower) || own.tokens.has(lower);
  const compoundTech = (lower) => {
    if (keepWhole(lower)) return null;
    for (const t of techTokens) {
      if (t.length < 3 || AMBIGUOUS_TECH.has(t) || !lower.startsWith(t) || lower === t) continue;
      const rest = lower.slice(t.length);
      if (COMPOUND_REST.has(rest) || COMMON_WORDS.has(rest) || techTokens.has(rest)) return t;
    }
    return null;
  };

  const companyTokens = new Set(tokensOf(company.toLowerCase()).map((t) => t.lower));
  const nameTokens = new Set([...companyTokens, ...tokensOf(role.toLowerCase()).map((t) => t.lower)]);
  const risk = new Set();
  // Capitalized posting words whose stem is common but whose exact form is not (Looker, Planner, Teams): product names.
  const capRisk = new Set();
  // Other terms of any posting bullet (responsibilities too): risk words only inside a first-person claim clause.
  const claimRisk = new Set();
  for (const ps of postingSentences(postingText)) {
    tokensOf(ps.text).forEach((t, i) => {
      const lower = t.lower;
      if (/^\d/.test(lower) || NUMBER_WORDS[lower] !== undefined || ORDINALS[lower] !== undefined) return;
      const forms = [...formsOf(lower)];
      const common = forms.some((f) => COMMON_WORDS.has(f));
      const capital = /^\p{Lu}/u.test(t.text);
      // A capitalized product name is grounded only by the same capitalized form in the cv (Teams, not "3 teams").
      if (common && i > 0 && capital && !COMMON_WORDS.has(lower) && !ownCased.has(t.text) && !nameTokens.has(lower)) capRisk.add(lower);
      // Words of the company name are plain words outside the name (public transit, a credit union); maskName checks the
      // whole name.
      if (common || (companyTokens.has(lower) && !ps.requirement) || forms.some((f) => own.forms.has(f))) return;
      // A proper term: capitalized inside a sentence, or opening a prose sentence (a bullet opens with a plain verb).
      const proper = capital && lower.length > 1 && (i > 0 || !ps.bulletLead);
      if (ps.requirement || proper) risk.add(lower);
      else if (ps.bullet && lower.length > 1) claimRisk.add(lower);
    });
  }
  const isRisk = (t) => techTokens.has(t.lower) || [...formsOf(t.lower)].some((f) => risk.has(f)) || (/^\p{Lu}/u.test(t.text) && capRisk.has(t.lower));
  // Tokens of the clauses that make a first-person claim with no apply or wish word ("I ran regression analysis").
  const claimTokens = (s) => new Set(s.split(CLAIM_CLAUSE_BREAK).filter((c) => {
    const lower = c.toLowerCase();
    return lastEnd(CLAIM_RE, lower) >= 0 && lastEnd(FRAME_RE, lower) < 0;
  }).flatMap((c) => tokensOf(c).map((t) => t.lower)));
  // The first word of a sentence is a name unless it is a common word, a number or ordinal, or grounded by the cv.
  const isName = (w) => {
    const toks = tokensOf(w.toLowerCase());
    return toks.some((t) => !isCommon(t.lower) && NUMBER_WORDS[t.lower] === undefined && ORDINALS[t.lower] === undefined && ![...formsOf(t.lower)].some((f) => own.forms.has(f)));
  };

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
    for (const q of quantitiesIn(sentence, { outreach: sources.outreach === true })) if (!q.grounded(own)) add(q.text);
    for (const t of titleClaims(sentence, own)) add(t);
    for (const t of SLASH_TERMS) if (t.re.test(sentence) && !t.re.test(own.lower)) add(t.text);
    const split = splitCamel(sentence, keepWhole);
    // An unsupported organization is reported once, not again word by word.
    const inOrg = new Set();
    for (const org of organizationsIn(sentence, isName)) {
      if (own.hasPhrase(org) || groundedAround(org)) continue;
      add(org);
      for (const t of tokensOf(`${org} ${splitCamel(org, keepWhole)}`)) inOrg.add(t.lower);
    }
    const keys = [phraseKey(sentence), phraseKey(split)];
    for (const p of techPhrases) {
      if (!keys.some((k) => k.includes(phraseKey(p)))) continue;
      if (!tokensOf(p).every((t) => inOrg.has(t.lower))) add(p);
    }
    const tokens = tokensOf(split);
    const inClaim = claimRisk.size ? claimTokens(split) : new Set();
    const claimRisky = (t) => inClaim.has(t.lower) && [...formsOf(t.lower)].some((f) => claimRisk.has(f));
    tokens.forEach((t, i) => {
      if (!(isRisk(t) || claimRisky(t)) || inOrg.has(t.lower)) return;
      if (AMBIGUOUS_TECH.has(t.lower) && !usedAsTech(tokens, i, split)) return;
      add(t.text);
    });
    for (const t of tokensOf(sentence)) {
      if (inOrg.has(t.lower)) continue;
      // A camelCase token was checked word by word above; here only as written (a posting word kept whole).
      if (t.text !== splitCamel(t.text, keepWhole) ? isRisk(t) : compoundTech(t.lower)) add(t.text);
    }
  }
  return [...missing.values()];
}

// The flagged items worth naming back to the model in a retry: grammar and common words are dropped, quantities kept.
export function retryTerms(items) {
  return items.filter((x) => {
    const toks = tokensOf(norm(x).toLowerCase());
    return quantitiesIn(norm(x)).length > 0 || toks.some((t) => !isCommon(t.lower));
  });
}
