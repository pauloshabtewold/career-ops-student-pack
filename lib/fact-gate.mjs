// Invented-fact gate for drafted letters and messages, built to fail closed. Every skill or tool term, number (digits,
// percentages and number words such as "three years" or "a couple of projects"), capitalized organization and claim to
// have held the role title must be grounded in cv.md or the application answers, whatever the sentence's subject. The
// posting grounds a sentence only when it states what the company needs: it opens with you, your <noun>, the company or
// the exact company name, a needs verb (uses, needs, seeks, requires, relies on, is hiring for, wants, builds with,
// works in) follows within 3 words, and it names no person or hire, no first person, no experience and no number
// ("Your team uses Tableau"). The company name and role title are cut out of each sentence before checking and never
// ground anything else ("Tableau Developer Intern" grounds no Tableau claim), except that a company name used as the
// student's tool or workplace ("I built pipelines in Snowflake") needs cv.md. A model can write a fluent line
// about a skill or a metric the student never had, and the posting is where most such lines come from; this check is
// plain code so it costs no tokens and never drifts.

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
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function numbersIn(text) {
  return [...String(text).matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0]);
}

// Number words with the digits they stand for; a vague count (few, several) or a plural-only one (dozens) has none.
const NUMBER_WORDS = Object.freeze({
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100',
  thousand: '1000', dozen: '12', couple: '2', dozens: null, hundreds: null, thousands: null, few: null, several: null,
});
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');
// Units that make a number word a count even when singular ("one year", "a dozen dashboard").
const UNIT = 'years?|yrs|months?|weeks?|days?|hours?|semesters?|terms?|quarters?|projects?|dashboards?|reports?|teams?|people|clients?|customers?|users?|students?|members?|apps?|tools?|models?|pipelines?|courses?|classes?|internships?|jobs?|roles?|papers?|awards?|languages?|times|percent|%';
// A number word counts when a unit or any plural word follows within 2 words; "one of" and "two of" are not counts, while
// "a couple of", "dozens of" and the like are.
const NUMBER_WORD_RE = new RegExp(`(?<![a-z])(${NUMBER_WORD})(?:\\s+of)?(?:\\s+[a-z'-]+){0,2}?\\s+(?:${UNIT}|[a-z'-]{2,}s)(?![a-z])`, 'gi');

function numberWordsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(NUMBER_WORD_RE)) {
    const word = m[1].toLowerCase();
    const ofCount = /^(?:couple|dozen|dozens|hundreds|thousands|few|several)$/.test(word);
    if (/^[a-z]+\s+of(?:\s|$)/i.test(m[0]) && !ofCount) continue;
    out.push(word);
  }
  return out;
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

const word = (alternatives) => new RegExp(`(?:^|[^a-z])(?:${alternatives})(?:[^a-z]|$)`, 'i');
const FIRST_PERSON = word('i|me|my|mine|myself|we|us|our|ours');
// Words that make a sentence a claim about someone's experience, whoever its grammatical subject is.
const EXPERIENCE = word('years?|yrs|months?|experience[ds]?|built|worked|led|skilled|hands-on|background|proficien(?:t|cy)|expertise|expert|developed|managed|designed|shipped|delivered|created|analy[sz]ed|interned|internship|proven|fluent|fluency');
// A person or a hire in the sentence makes it about whoever fills the role, not about the company's needs; a relative
// clause, "this" or a pointer to the student's materials does the same.
const PERSON = word("analysts?|interns?|candidates?|applicants?|specialists?|engineers?|developers?|hires?|someone|somebody|persons?|people|who|whom|whose|which|this|these|by|portfolio|attached|linked|below|resume|cv");
const ANY_NUMBER = new RegExp(`\\d|(?<![a-z])(?:${NUMBER_WORD})(?![a-z])`, 'i');
const NEEDS_VERB = "(?:use[sd]?|needs?|seeks?|requires?|rel(?:y|ies) on|(?:is|are) hiring for|wants?|builds? with|works? in)(?![a-z])";

// True when the sentence states what the company needs: it opens with you, your <noun>, the company or the exact company
// name, a needs verb starts within the 3 words after that subject, and it holds no person or hire, first person,
// experience word or number. Only such a sentence may be grounded by the posting.
function statesCompanyNeed(sentence, company) {
  if (PERSON.test(sentence) || FIRST_PERSON.test(sentence) || EXPERIENCE.test(sentence) || ANY_NUMBER.test(sentence)) return false;
  const head = sentence.trim().replace(/^[("'\s]+/, '').toLowerCase();
  const subjects = ["you(?![a-z'’])", "your\\s+[a-z'’-]+", 'the company(?![a-z])'];
  if (company) subjects.push(`${escapeRe(company)}(?:['’]s)?(?![a-z0-9])`);
  const m = new RegExp(`^(?:${subjects.join('|')})`).exec(head);
  if (!m) return false;
  const rest = head.slice(m[0].length).replace(/[^a-z0-9'’-]+/g, ' ');
  return new RegExp(`^\\s*(?:[a-z0-9'’-]+\\s+){0,2}${NEEDS_VERB}`).test(rest);
}

// Cuts every exact, case-insensitive occurrence of name out of the sentence.
const cut = (sentence, name) => (name ? sentence.replace(new RegExp(`(?<![a-z0-9])${escapeRe(name)}(?![a-z0-9])`, 'gi'), ' ') : sentence);

// Wishes and applications ("excited to apply as", "hope to join as") between the verb and "as" are not claims.
const WISH = '(?!(?:apply|applying|applied|join|joining|start|starting|begin|considered|excited|eager|glad|thrilled|happy|hope|hoping|hoped|want|wanted|love|like|interested|chance|opportunity)(?![a-z]))';

// True when the sentence says someone held the role title: worked, served or interned as it, a former or previous one,
// or time, years or experience as it.
function claimsTitle(lower, role) {
  const title = `(?:an?\\s+|the\\s+)?${escapeRe(role)}(?![a-z0-9])`;
  const held = new RegExp(`(?:^|[^a-z])(?:(?:worked|served|interned|employed|experience|time|tenure|stint|years?|months?|was|were|been)\\s+(?:${WISH}[a-z'-]+\\s+){0,3}?as\\s+${title}|(?:former|formerly|previous|previously|past|prior|ex-)\\s*${title}|(?:held|hold|holding)\\s+(?:the\\s+)?(?:title|position|role|job)\\s+(?:of\\s+)?${title})`);
  return held.test(lower);
}

// sources = { cv, answers, posting, company?, role?, extra? } where company and role (and extra, older callers) are the
// target names: they are cut out of each sentence and ground nothing. Returns the unsupported items, empty when the draft
// passes.
export function check(text, sources = {}) {
  const own = [sources.cv, flatten(sources.answers)].join('\n').toLowerCase();
  const withPosting = `${own}\n${String(sources.posting ?? '').toLowerCase()}`;
  const ownNumbers = new Set(numbersIn(own).map(normNumber));
  const groundedNumber = (n) => ownNumbers.has(normNumber(n)) || Object.entries(NUMBER_WORDS).some(([w, d]) => d === normNumber(n) && new RegExp(`(?<![a-z])${w}(?![a-z])`).test(own));
  const groundedWord = (w) => new RegExp(`(?<![a-z])${w}(?![a-z])`).test(own) || (NUMBER_WORDS[w] !== null && ownNumbers.has(NUMBER_WORDS[w]));
  const name = (v) => (typeof v === 'string' ? v.trim() : '');
  const companyName = name(sources.company).toLowerCase();
  const role = name(sources.role).toLowerCase();
  const names = [role, companyName, ...[sources.extra].flat().map(name).map((t) => t.toLowerCase())].filter(Boolean).sort((a, b) => b.length - a.length);
  // The company name as a tool ("in Snowflake", "using Snowflake") in a first-person or experience sentence, or as a
  // workplace ("at Acme", "with Acme") in an experience sentence, is a claim about the student.
  const after = (preps) => companyName && new RegExp(`(?:^|[^a-z])(?:${preps})\\s+(?:the\\s+)?${escapeRe(companyName)}(?![a-z0-9])`, 'i');
  const asTool = after('in|using|on');
  const asWorkplace = after('at|with');
  const companyClaim = (s) => Boolean(companyName) && ((asTool.test(s) && (FIRST_PERSON.test(s) || EXPERIENCE.test(s))) || (asWorkplace.test(s) && EXPERIENCE.test(s)));
  const missing = new Map();
  const add = (item) => missing.set(item.toLowerCase(), missing.get(item.toLowerCase()) ?? item);
  for (const sentence of sentencesOf(text)) {
    const pool = statesCompanyNeed(sentence, companyName) ? withPosting : own;
    if (companyClaim(sentence) && !own.includes(companyName)) add(name(sources.company));
    if (role && !own.includes(role) && claimsTitle(sentence.toLowerCase(), role)) add(name(sources.role));
    const rest = names.reduce(cut, sentence);
    for (const n of numbersIn(rest)) if (!groundedNumber(n)) add(n);
    for (const w of numberWordsIn(rest)) if (!groundedWord(w)) add(w);
    for (const org of organizationsIn(rest)) if (!has(pool, org)) add(org);
    for (const skill of skillsIn(rest)) if (!has(pool, skill)) add(skill);
  }
  return [...missing.values()];
}
