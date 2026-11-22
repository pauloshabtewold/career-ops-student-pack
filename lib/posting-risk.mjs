// Scam and ghost-job signals in a posting, by plain rules with zero model calls. A scam rule hit means the posting asks
// the student for money, moves the student off the employer's channels, or gives an application contact on a domain that
// is not the employer's; a ghost rule hit means the same posting has been reposted for months. The rules stay narrow so
// legitimate postings do not fail (the quality bar allows 2% false positives on the legitimate fixtures): an employer
// paying for equipment, an accommodation or benefits email and an optional chat-app line are all normal.

const PAY_VERB = /\b(pay|purchase|buy|deposit|send|wire)\b/gi;
const NOT_A_PAYMENT = /^(pay\s+(attention|close|careful)|deposit\s+slip)/i;
// The words just before the verb name the employer as the payer ("we provide and pay for", "our company will buy").
const EMPLOYER_PAYS = /\b(we|our company|the company|our team|the employer|employer|they)\b(?:\s+\w+){0,3}\s*$/i;
// The words just before the verb oblige the student ("you must", "selected candidates must").
const STUDENT_OBLIGED = /\b(you|candidates?|applicants?|new hires?|interns?|trainees?|hires?)\b[^.;]{0,25}\b(must|will need to|need to|have to|are required to|is required to|will be required to|are expected to)\s+(?:first\s+)?$/i;
const STUDENT_COST = /\b(your own (money|funds|expense|card)|with your own|upfront|up front|out of pocket|before (you start|your first day|onboarding|you begin|starting)|to secure (your|a|the) (spot|place|position|seat))\b/i;
const REIMBURSE_AFTER = /\breimburs\w*\b[^.]{0,60}\b(after|later|once|when|upon)\b/i;
const MONEY_OBJECT = /^(send|wire)\b[^.]{0,30}\b(money|payment|funds)\b/i;
const MONEY_ANY = /\bgift cards?\b|\bwire transfer\b|\bcashier'?s check\b/i;

const CHAT_APPS = 'telegram|whatsapp|wickr|google hangouts|wechat';
const CHAT_EXCLUSIVE = new RegExp(`\\b(only|exclusively|solely)\\b[^.]{0,30}\\b(${CHAT_APPS}|signal)\\b|\\b(${CHAT_APPS}|signal)\\b[^.]{0,15}\\b(only|exclusively)\\b`, 'i');
const CHAT_CONTACT = new RegExp(`\\b(contact|message|text|reach|interview)\\b[^.]{0,40}\\b(on|via|through|using)\\s+(${CHAT_APPS}|signal)\\b`, 'i');
const OTHER_CHANNEL = /\b(apply (on|through|via|at|online)|careers? (site|page|portal)|application portal|our (site|website)|e-?mail|phone|call us)\b|@[a-z0-9-]+\.[a-z]{2,}/i;

const FREE_MAIL = /\b[A-Z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|aol|proton(mail)?|icloud)\.[a-z.]+\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})\b/gi;
const SHARED_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|jobvite\.com)$/i;
// Suffixes stripped before the organization label is read: RFC 2606's reserved example domains act as a suffix, so
// fixtures written as <org>.example.com compare like <org>.com.
const SUFFIX = /\.(example\.(com|org|net|edu)|(com?|ac|org|net|edu|gov)\.[a-z]{2}|[a-z]{2,})$/i;
// An email in one of these sentences is an HR side channel, not the application contact.
const SIDE_CHANNEL = /\b(accommodations?|disabilit(y|ies)|eeo|equal (employment )?opportunity|benefits|privacy|accessib\w*|reasonable adjustments?)\b/i;

export const REPOST_MAX = 3;
export const AGE_DAYS_MAX = 60;

const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const chunks = (text) => String(text ?? '').split(/(?<=[.!?])\s+|\n+/);

// True when a sentence asks the student, not the employer, to pay, buy or send money.
function studentPays(chunk) {
  for (const m of chunk.matchAll(PAY_VERB)) {
    const rest = chunk.slice(m.index);
    if (NOT_A_PAYMENT.test(rest)) continue;
    const before = chunk.slice(Math.max(0, m.index - 40), m.index);
    if (EMPLOYER_PAYS.test(before)) continue;
    const money = /^(send|wire)/i.test(m[0]) ? MONEY_OBJECT.test(rest) : true;
    if (!money) continue;
    if (STUDENT_OBLIGED.test(before) || STUDENT_COST.test(chunk) || REIMBURSE_AFTER.test(rest)) return true;
  }
  return false;
}

const paymentAsked = (text) => MONEY_ANY.test(text ?? '') || chunks(text).some(studentPays);

// Chat-app contact counts only when the posting says it is the only channel, or names no other way to apply or reach it.
const chatOnly = (text) => CHAT_EXCLUSIVE.test(text ?? '') || (CHAT_CONTACT.test(text ?? '') && !OTHER_CHANNEL.test(String(text).replace(CHAT_CONTACT, '')));

// Company words' initials ("Example University Hospital" -> euh), for employers whose domain is an abbreviation.
const initials = (company) => String(company ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(of|the|and|inc|llc|co|corp)$/.test(w)).map((w) => w[0]).join('');

// An application email on a domain that shares nothing with the company name (and is not an ATS host) suggests an
// impersonator. Unknown companies and HR side-channel sentences are skipped: there is nothing to compare or it is no lead.
function domainMismatch(text, company) {
  if (!String(company ?? '').trim() || /^unknown$/i.test(String(company).trim())) return false;
  const name = compact(company).replace(/(inc|llc|corp|corporation|company|co|group)$/, '');
  if (name.length < 3) return false;
  const abbr = initials(company);
  for (const chunk of chunks(text)) {
    if (SIDE_CHANNEL.test(chunk)) continue;
    for (const m of chunk.matchAll(EMAIL)) {
      const domain = m[1].toLowerCase();
      if (FREE_MAIL.test(m[0]) || SHARED_HOSTS.test(domain)) continue;
      const label = compact(domain.replace(SUFFIX, '').split('.').pop());
      if (label.includes(name.slice(0, 6)) || (label.length >= 3 && name.startsWith(label)) || (abbr.length >= 2 && label.startsWith(abbr))) continue;
      return true;
    }
  }
  return false;
}

// Rule names for one posting: scam-* rules fail the row, ghost-* fail it as a stale repost. repostCount and ageDays come
// from fresh-scan's seen file through the row's reposts= and posted= notes, else 0.
export function riskRules({ text, company, repostCount = 0, ageDays = 0 }) {
  const out = [];
  if (paymentAsked(text)) out.push('scam-payment');
  if (chatOnly(text)) out.push('scam-chat-only');
  const personal = FREE_MAIL.test(text ?? '');
  if (domainMismatch(text, company)) out.push('scam-domain');
  // A recruiter on a free mail address is common at small employers, so it counts only next to another scam signal.
  if (personal && out.length) out.push('scam-personal-email');
  if (repostCount > REPOST_MAX && ageDays > AGE_DAYS_MAX) out.push('ghost-stale-repost');
  return out;
}

export const isRisky = (rules) => rules.length > 0;
export const riskReason = (rules) => `rule scam: ${rules.join(', ')}`;
