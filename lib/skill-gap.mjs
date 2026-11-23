// Weekly skill-gap report, by plain code: requirement phrases that keep showing up in the saved job text of matched
// (PASS) postings from the last 7 days but are absent from cv.md, with what to learn or build from a static map per field.

export const MIN_POSTINGS = 3;

// Field keywords checked as whole phrases; noun-phrase n-grams after "experience with" / "proficiency in" add the rest.
const KEYWORDS = ['sql', 'python', 'r', 'excel', 'tableau', 'power bi', 'java', 'javascript', 'react', 'aws', 'docker', 'git', 'statistics', 'machine learning', 'financial modeling', 'accounting', 'gaap', 'epic', 'bls certification', 'acls', 'policy analysis', 'grant writing', 'stata', 'gis', 'salesforce', 'agile', 'jira', 'linux', 'c++', 'data visualization'];
const LEAD = /\b(?:experience (?:with|in)|proficiency (?:with|in)|knowledge of|familiarity with)\s+([a-z0-9+#][a-z0-9+# ./-]{2,40}?)(?=[,.;)]| and | or |\n|$)/gi;

export const SUGGESTIONS = Object.freeze({
  sql: 'work through a SQL course and build one query-heavy project on a public dataset',
  python: 'finish one small Python project end to end and put it on GitHub',
  tableau: 'publish one dashboard on Tableau Public from a public dataset',
  'power bi': 'build one Power BI report from a public dataset',
  excel: 'practice pivot tables and lookups on a real dataset',
  'machine learning': 'train and write up one model on a public dataset',
  'financial modeling': 'build a three-statement model for one public company',
  aws: 'deploy one small app with the AWS free tier',
  docker: 'containerize one of your projects',
  'policy analysis': 'write a two-page policy memo on a current issue',
  'grant writing': 'draft a mock grant proposal for a local nonprofit',
  'bls certification': 'book a BLS course through your school or the AHA',
  acls: 'ask your program about an ACLS course before graduation',
});

const has = (text, phrase) => new RegExp(`(^|[^a-z0-9+#])${phrase.replace(/[.+#]/g, '\\$&')}([^a-z0-9+#]|$)`, 'i').test(text);

// Requirement phrases of one posting: the known skill keywords it names and the phrases after a requirement lead.
export function requirementPhrases(jobText) {
  const lower = String(jobText ?? '').toLowerCase();
  const out = new Set(KEYWORDS.filter((k) => has(lower, k)));
  for (const m of lower.matchAll(LEAD)) out.add(m[1].trim());
  return [...out];
}

// jobTexts: saved texts of PASS rows from the last 7 days. Returns [{ phrase, postings, suggestion }] sorted by count.
export function skillGaps(jobTexts, cvText) {
  const counts = new Map();
  for (const text of jobTexts) for (const p of requirementPhrases(text)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const cv = String(cvText ?? '').toLowerCase();
  return [...counts]
    .filter(([p, n]) => n >= MIN_POSTINGS && !has(cv, p))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([phrase, postings]) => ({ phrase, postings, suggestion: SUGGESTIONS[phrase] ?? `add one project or course that shows ${phrase}` }));
}
