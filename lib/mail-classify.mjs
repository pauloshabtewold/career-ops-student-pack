// Classifies one normalized mail message from its subject, snippet and sender domain. It never reads outside the message.
const ALERT_DOMAINS = { 'linkedin.com': 'linkedin-alert', 'joinhandshake.com': 'handshake-alert' };

export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const senderAddress = (from) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const senderDomain = (from) => senderAddress(from).split('@').pop().replace(/[^a-z0-9.-]/g, '');
const underDomain = (domain, base) => domain === base || domain.endsWith(`.${base}`);

function companyFor(domain, companies) {
  const labels = new Set(domain.split('.').map(compact));
  return companies.find((c) => (c.domains ?? []).some((d) => underDomain(domain, d.toLowerCase())) || labels.has(compact(c.name))) ?? null;
}

const SUSPICIOUS = [
  /\b(ssn|social security)\b/i,
  /\bbank (account|details|routing|login)\b|\brouting number\b|\baccount number\b/i,
  /\bpassword\b/i,
  /\bverif(y|ication)\b[^.]{0,40}\blink\b|\blink\b[^.]{0,40}\bverify\b/i,
  /\b(ignore|disregard) (all |any )?(previous|prior|above) (instructions|messages)\b|\b(ai|llm) (assistant|agent|model)\b|\bdear (ai|assistant|claude)\b/i,
];
const REJECTION = /\b(move|moving|proceed|proceeding) forward with (other|another)\b|\bregret to inform\b|\bunfortunately\b|\bnot (be )?(moving|selected|proceeding)\b|\bdecided not to\b|\bposition has been filled\b/i;
const CONFIRMATION = /\bautomated\b|\bdo not reply\b|\bdon't reply\b|\breceived your application\b|\bthank(s| you) for applying\b/i;
// A receipt that only promises a possible interview is not an interview request.
const CONDITIONAL = /\bif (you are |you're )?selected\b|\bshould you be selected\b|\bmay contact you\b/i;
const INTERVIEW = /\binterview\b/i;
const SCHEDULING = /\b(availability|schedul(e|ing)|calendly|book a (time|slot)|(few|some) times|times (that |which )?(work|suit)|a call|phone screen)\b/i;
const ASKS = /\?|\bplease (send|provide|reply|respond|complete|fill|upload|confirm|let us know)\b/i;
const DUE = /\b(\d{4}-\d{2}-\d{2})\b/;

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// A company name matches only as whole words, so "Apple" never hits "Pineapple Corp"; the longest name wins.
function findCompany(text, companies) {
  const haystack = words(text);
  const hits = (name) => {
    const needle = words(name);
    if (!needle.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      if (needle.every((w, k) => haystack[i + k] === w)) return true;
    }
    return false;
  };
  return companies.filter((c) => hits(c.name)).sort((x, y) => compact(y.name).length - compact(x.name).length)[0] ?? null;
}

function alertRow(m, label) {
  const at = m.subject.lastIndexOf(' at ');
  if (at < 1) return null;
  const clean = (s) => squash(s.replace(/\S*linkedin\.com\S*/gi, '').replace(/[|;]/g, ','));
  const link = /https?:\/\/[^\s)>\]]+/.exec(m.snippet)?.[0] ?? '';
  let jobId = '';
  try {
    jobId = new URL(link).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    jobId = '';
  }
  const title = clean(m.subject.slice(0, at));
  const company = clean(m.subject.slice(at + 4));
  return title && company ? { label, title, company, jobId: /^[A-Za-z0-9_-]+$/.test(jobId) ? jobId : '' } : null;
}

// ctx = { assessmentDomains, companies: [{ name, domains? }] }; returns { kind, ... } and never reads outside the message.
export function classifyMail(message, ctx) {
  const text = `${message.subject} ${message.snippet}`;
  const domain = senderDomain(message.from);
  const base = { id: message.id };
  if (SUSPICIOUS.some((re) => re.test(text))) return { ...base, kind: 'suspicious' };
  for (const [alertDomain, label] of Object.entries(ALERT_DOMAINS)) {
    if (underDomain(domain, alertDomain)) {
      const row = alertRow(message, label);
      return row ? { ...base, kind: 'alert', ...row } : { ...base, kind: 'ignore' };
    }
  }
  const sender = companyFor(domain, ctx.companies);
  const assess = (ctx.assessmentDomains ?? []).find((d) => underDomain(domain, d.toLowerCase()));
  const company = sender ?? (assess ? findCompany(text, ctx.companies) : null);
  if (!company && !assess) return { ...base, kind: 'ignore' };
  const info = { ...base, company: company?.name ?? '' };
  if (company) {
    if (REJECTION.test(text)) return { ...info, kind: 'rejection' };
    // Conditional wording (if selected, may contact you) marks a plain receipt, so it is ignored before the interview rules run.
    if (!assess && CONDITIONAL.test(text)) return { ...info, kind: 'ignore' };
    // Interview and scheduling come before the receipt rule: "Thanks for applying" opens many real interview invitations.
    if (INTERVIEW.test(text)) return { ...info, kind: 'interview' };
    if (SCHEDULING.test(text)) return { ...info, kind: 'scheduling' };
    if (!assess && CONFIRMATION.test(text)) return { ...info, kind: 'ignore' };
  }
  if (assess) {
    const due = DUE.exec(text)?.[1] ?? 'unknown';
    return { ...info, kind: 'assessment', note: `OA ${assess.split('.')[0]}, due ${due}` };
  }
  if (ASKS.test(text)) return { ...info, kind: 'question' };
  return { ...info, kind: 'reply' };
}
