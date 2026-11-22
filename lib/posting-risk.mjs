// Scam and ghost-job signals in a posting, by plain rules with zero model calls. A scam rule hit means the posting asks
// for money, moves the student off the employer's channels, or comes from a domain that is not the employer's; a ghost
// rule hit means the same posting has been reposted for months. The rules stay narrow so legitimate postings do not fail
// (the quality bar allows 2% false positives on the legitimate fixtures).

const PAYMENT = /\b(pay|purchase|buy|deposit)\b[^.]{0,50}\b(equipment|starter kit|training (fee|materials)|background check fee|software license)\b|\b(send|wire)\b[^.]{0,30}\b(money|payment|check)\b|\bgift cards?\b|\bwire transfer\b/i;
const CHAT_ONLY = /\b(contact|message|text|reach|interview)\b[^.]{0,40}\b(on|via|through|using)\s+(telegram|whatsapp|signal|wickr|google hangouts)\b/i;
const FREE_MAIL = /\b[A-Z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|aol|proton(mail)?|icloud)\.[a-z.]+\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})\b/gi;
const SHARED_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|jobvite\.com|example\.(com|org|net|edu))$/i;

export const REPOST_MAX = 3;
export const AGE_DAYS_MAX = 60;

const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// An email on a domain that shares nothing with the company name (and is not an ATS host) suggests an impersonator.
function domainMismatch(text, company) {
  const name = compact(company).replace(/(inc|llc|corp|corporation|company|co|group)$/, '');
  if (name.length < 3) return false;
  for (const m of String(text ?? '').matchAll(EMAIL)) {
    const domain = m[1].toLowerCase();
    if (FREE_MAIL.test(m[0]) || SHARED_HOSTS.test(domain)) continue;
    if (!compact(domain).includes(name.slice(0, 6))) return true;
  }
  return false;
}

// Rule names for one posting: scam-* rules fail the row, ghost-* fail it as a stale repost.
export function riskRules({ text, company, repostCount = 0, ageDays = 0 }) {
  const out = [];
  if (PAYMENT.test(text ?? '')) out.push('scam-payment');
  if (CHAT_ONLY.test(text ?? '')) out.push('scam-chat-only');
  const personal = FREE_MAIL.test(text ?? '');
  if (domainMismatch(text, company)) out.push('scam-domain');
  // A recruiter on a free mail address is common at small employers, so it counts only next to another scam signal.
  if (personal && out.length) out.push('scam-personal-email');
  if (repostCount >= REPOST_MAX && ageDays >= AGE_DAYS_MAX) out.push('ghost-stale-repost');
  return out;
}

export const isRisky = (rules) => rules.length > 0;
export const riskReason = (rules) => `rule scam: ${rules.join(', ')}`;
