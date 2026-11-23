// Outcome mail rules: rejection, interview and offer phrases plus a sender-domain match to the tracked company. A row
// changes on its own only when the phrase rule and the sender domain agree; anything else is a proposal for the student.
// Lever T7 decides where the agent classifier comes in: off (default) every outcome-candidate mail also goes to the
// agent and a row changes only when the agent class, the rule and the domain all agree; on, the rules run first and only
// mail they do not match goes to the agent. Unclear mail is a proposal on both paths.

export const OUTCOMES = Object.freeze({ rejection: 'Rejected', interview: 'Interview', offer: 'Offer' });

const RULES = [
  ['offer', /\b(pleased|happy|delighted|excited) to (extend|offer)\b|\boffer letter\b|\bjob offer\b|\bformal offer\b/i],
  ['rejection', /\bregret to inform\b|\b(move|moving|proceed|proceeding) forward with (other|another)\b|\bnot (be )?(moving|selected|proceeding)\b|\bdecided not to\b|\bposition has been filled\b|\bunfortunately\b[^.]{0,60}\b(not|other candidates)\b/i],
  ['interview', /\b(invite|invitation|like) (you )?to (an |a )?(interview|phone screen|video call)\b|\bschedule (an |a |your )?(interview|call)\b|\binterview (availability|invitation)\b/i],
];
const CONDITIONAL = /\bif (you are |you're )?selected\b|\bshould you be selected\b|\bmay contact you\b/i;

const ADDRESS = /[^\s<>"',;:()[\]]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// Two-part public suffixes, and the reserved test domains (RFC 2606/6761), which real mail never comes from and which act
// as a suffix in fixtures (recruiting@northwindrobotics.example.com).
const TWO_PART = new Set(['co.uk', 'ac.uk', 'org.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'ac.nz', 'co.jp', 'ac.jp', 'co.in', 'ac.in', 'co.kr', 'co.za', 'com.br', 'com.mx', 'com.cn', 'com.sg', 'com.hk', 'com.tw', 'com.tr', 'co.il', 'ac.il', 'com.ar', 'example.com', 'example.org', 'example.net']);
// ATS and mailbox domains send for many companies, so a company name in front of them never proves the sender.
const RELAYS = new Set(['greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'myworkday.com', 'workday.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'taleo.net', 'successfactors.com', 'bamboohr.com', 'workable.com', 'breezy.hr', 'recruitee.com', 'jazzhr.com', 'applytojob.com', 'eightfold.ai', 'paradox.ai', 'joinhandshake.com', 'linkedin.com', 'indeed.com', 'ziprecruiter.com', 'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com']);
const MIN_NAME = 4;

// The sender's domain from a strictly parsed address: the last <local@domain> in angle brackets, else the last bare
// local@domain; '' when the header holds no address (a bracket without an @ is never taken as a domain).
function domainOf(from) {
  const text = String(from ?? '');
  const bracketed = [...text.matchAll(/<([^<>]*)>/g)].map((m) => m[1].trim()).filter((v) => v.includes('@'));
  const source = bracketed.length ? bracketed.at(-1) : text;
  const all = [...source.matchAll(ADDRESS)];
  const domain = all.length ? all.at(-1)[1].toLowerCase() : '';
  return HOST.test(domain) ? domain : '';
}

// { label, registrable } of a host: the label directly left of the public suffix and that label plus the suffix.
function registrableOf(domain) {
  const labels = domain.split('.');
  const two = labels.length >= 3 && TWO_PART.has(labels.slice(-2).join('.'));
  const size = two ? 3 : 2;
  if (labels.length < size) return { label: '', registrable: '' };
  return { label: labels.at(-size), registrable: labels.slice(-size).join('.') };
}
const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const companyOf = (company) => (typeof company === 'string' ? { name: company } : (company ?? {}));
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Outcome class of a mail phrase; null for conditional wording or no matching rule.
export function phraseClass(text) {
  if (CONDITIONAL.test(text ?? '')) return null;
  return RULES.find(([, re]) => re.test(text ?? ''))?.[0] ?? null;
}

// The sender domain belongs to the company: it equals or sits under one of the company's listed domains, or its
// registrable label (the one left of the public suffix) equals the company name with spaces and punctuation removed, for
// names of at least MIN_NAME characters. A company label anywhere else (northwind.evil.com, northwind.greenhouse.io) and
// any ATS or mailbox relay never match. company is the tracked name or { name, domains }.
export function domainMatches(from, company) {
  const c = companyOf(company);
  const domain = domainOf(from);
  if (!domain || !c.name) return false;
  const { label, registrable } = registrableOf(domain);
  if (!registrable) return false;
  const name = compact(c.name);
  if (RELAYS.has(registrable) && compact(label) !== name) return false;
  const listed = (c.domains ?? []).map((d) => String(d).trim().toLowerCase()).filter((d) => HOST.test(d));
  if (listed.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return name.length >= MIN_NAME && compact(label) === name;
}

// The tracked company named in the text as whole words (the longest name wins), or null. A mail from another domain
// that names a tracked company can only become a proposal, so this never changes a row by itself.
export function companyInText(text, companies) {
  const hay = words(text);
  const hits = (name) => {
    const needle = words(name);
    if (!needle.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, k) => hay[i + k] === w)) return true;
    return false;
  };
  return companies.filter((c) => hits(c.name)).sort((x, y) => compact(y.name).length - compact(x.name).length)[0] ?? null;
}

/**
 * Decides one outcome-candidate mail. mail = { from, subject, snippet or text }, company = the tracked name or
 * { name, domains? }. classify(mail) is the agent classifier (async, resolves rejection|interview|offer|unclear, or null
 * when the call failed); t7On picks the order. Returns { status } to apply, { proposal } for the student, or { none: true }.
 */
export async function decideOutcome(mail, company, { t7On = false, classify = null } = {}) {
  const text = `${mail.subject ?? ''} ${mail.text ?? mail.snippet ?? ''}`;
  const rule = phraseClass(text);
  const domain = domainMatches(mail.from, company);
  if (t7On) {
    if (rule && domain) return { status: OUTCOMES[rule], kind: rule, by: 'rules' };
    const agent = classify ? await classify(mail) : null;
    if (OUTCOMES[agent]) return { proposal: OUTCOMES[agent], kind: agent, by: 'agent' };
    return rule ? { proposal: OUTCOMES[rule], kind: rule, by: 'rules' } : { none: true };
  }
  const agent = classify ? await classify(mail) : null;
  if (rule && domain && agent === rule) return { status: OUTCOMES[rule], kind: rule, by: 'agreement' };
  const seen = rule ?? (OUTCOMES[agent] ? agent : null);
  return seen ? { proposal: OUTCOMES[seen], kind: seen, by: 'disagreement' } : { none: true };
}
