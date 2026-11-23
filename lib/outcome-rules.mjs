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

const domainOf = (from) => (/<([^>]+)>/.exec(from ?? '')?.[1] ?? from ?? '').trim().toLowerCase().split('@').pop();
const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const companyOf = (company) => (typeof company === 'string' ? { name: company } : (company ?? {}));
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Outcome class of a mail phrase; null for conditional wording or no matching rule.
export function phraseClass(text) {
  if (CONDITIONAL.test(text ?? '')) return null;
  return RULES.find(([, re]) => re.test(text ?? ''))?.[0] ?? null;
}

// The sender domain belongs to the company: its listed domains, or a domain label equal to the company name.
// company is the tracked name or { name, domains }.
export function domainMatches(from, company) {
  const c = companyOf(company);
  const domain = domainOf(from);
  if (!domain || !c.name) return false;
  if ((c.domains ?? []).some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) return true;
  const name = compact(c.name);
  return name.length >= 3 && domain.split('.').some((label) => compact(label) === name);
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
