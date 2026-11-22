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
const STUDENT_OBLIGED = /\b(you|candidates?|applicants?|new hires?|interns?|trainees?|hires?)\b[^.;]{0,25}\b(must|will need to|need to|have to|are required to|is required to|will be required to|are expected to)\s+(?:(?:first|then|also)\s+)?$/i;
const STUDENT_COST = /\b(your own (money|funds|expense|card)|with your own|upfront|up front|out of pocket|before (you start|your first day|onboarding|you begin|starting)|to secure (your|a|the) (spot|place|position|seat))\b/i;
const REIMBURSE_AFTER = /\breimburs\w*\b[^.]{0,60}\b(after|later|once|when|upon)\b/i;
// "Buy it and get reimbursed after" counts only for things a scam sells: equipment, software, kits, training and fees.
const SOLD_OBJECT = /^[^.;]{0,50}\b(equipment|laptops?|computers?|printers?|monitors?|software|licen[cs]es?|kits?|supplies|materials|training|courses?|certifications?|fees?|devices?|phones?|tools?)\b/i;
// Travel, parking, transit, commuting and moving costs are normal to front and claim back; they are not a payment ask.
const TRAVEL_OBJECT = /^[^.;]{0,40}\b(travel|flights?|airfare|hotels?|lodging|parking|transit|commut\w*|relocat\w*|moving|mileage|(bus|train|metro|subway) (pass|fare|tickets?)|housing|meals?|lunch(es)?|gas|fuel)\b/i;
// The passive form of a student purchase: "Equipment must be purchased", "a fee is paid by each trainee".
const PASSIVE_PAY = /\b(must|has to|have to|is required to|are required to|will need to) be (purchased|bought|paid)\b|\b(is|are) (paid|purchased|bought) by (each |the |every |a )?(new hire|trainee|intern|candidate|applicant|student|hire)s?\b/i;
// The student picks the item ("the monitor you like", "any course"): an employer benefit claimed back with a receipt.
const STUDENT_PICKS = /\b(you (like|want|choose|prefer|pick)|of your choice|any)\b[^.]*?\breimburs/i;
// An imperative fee at the start of a sentence: "Pay a $60 registration fee", "Buy the starter kit".
const IMPERATIVE_FEE = /^(pay|purchase|buy)\s+(?:(?:a|an|the|your|our)\s+)?(?:\$\s?\d[\d,.]*\s+)?(?:[\w-]+\s+){0,2}?(fee|kit|equipment|deposit|materials)\b/i;
const MONEY_OBJECT = /^(send|wire)\b[^.]{0,30}\b(money|payment|funds)\b/i;
const MONEY_ANY = /\bgift cards?\b|\bwire transfer\b|\bcashier'?s? check\b/i;
// The fake-check scam: the employer sends a check, the student deposits it and buys from "our vendor", buys something in
// the same or the next sentence, or sends the rest back. A check alone (a stipend check, a paycheck) is not the scam, and
// "check-in" or "check-up" is not a check.
const CHECK = '(check|cheque)(?![-\\w])';
const CHECK_SENT = new RegExp(`\\b(send|mail|give|issue)\\s+you\\s+a\\s+${CHECK}|\\b(receive|get)\\s+a\\s+${CHECK}|\\b(deposit|cash)\\s+(it|the\\s+${CHECK})`, 'i');
const VENDOR_NAMED = /\b(our|approved|designated|preferred|the|a)\s+(\w+\s+)?(vendor|supplier)s?\b|\bthe (employer|company|firm|team)'s\s+(\w+\s+)?(vendor|supplier)s?\b/i;
const CHECK_SPEND = new RegExp(`${VENDOR_NAMED.source}|\\b(send|return|wire|forward|transfer|pay)\\b[^.]{0,30}\\b(balance|rest|difference|excess|remaining|leftover)\\b`, 'i');
const SPEND_VERB = /\b(buy|purchase)\b/i;
const VENDOR = /\b(vendors?|suppliers?)\b/i;
// Employer funding in the sentence ("with your $1,000 stipend", "a budget to buy books", "the team covers the cost")
// means the student spends the employer's money, not their own. It does not hold when the same sentence also says their
// own money, obliges the student, names a start-date deadline, names a vendor, or asks for a fee, deposit or kit: "an
// equipment stipend" is the usual wording of the fake-equipment scam.
const EMPLOYER_FUNDED = /\b(stipends?|allowances?|budgets?|we (cover|provide|pay for)|covers? the cost|covered by (us|the company|the employer)|(company|employer)-(provided|paid|funded)|provided by (us|the company|the employer))\b/i;
const OWN_MONEY = /\b(your own (money|funds|card)|out of pocket|upfront|up front)\b/i;
const OBLIGATION = /\b(must|requires? you to|required to|need to|have to)\b/i;
const FEE_OBJECT = /\b(fees?|deposits?|kits?)\b/i;
const employerFunded = (chunk) =>
  EMPLOYER_FUNDED.test(chunk) && ![OWN_MONEY, OBLIGATION, STUDENT_COST, VENDOR, FEE_OBJECT].some((re) => re.test(chunk));

// "signalapp" stands for Signal the messenger after signalApp() has told it apart from the word signal.
const CHAT_APPS = 'telegram|whatsapp|wickr|google hangouts|wechat|signalapp';
const CHAT_EXCLUSIVE = new RegExp(`\\b(only|exclusively|solely)\\b[^.]{0,30}\\b(${CHAT_APPS})\\b|\\b(${CHAT_APPS})\\b[^.]{0,15}\\b(only|exclusively)\\b`, 'i');
const CHAT_CONTACT = new RegExp(`\\b(contact|message|text|reach|interview)\\b[^.]{0,40}\\b(on|via|through|using)\\s+(${CHAT_APPS})\\b`, 'i');
// Signal is also a common word ("RF signal processing", "mixed-signal"), so it counts as the messenger only as "Signal
// app" or "Signal messenger", as a capitalized Signal after a contact verb ("text us on Signal"), or as a capitalized
// Signal next to a handle or phone number. A capitalized word after it ("Signal Processing Slack") makes it a name.
const SIGNAL_NAMED = /\bsignal(?=\s+(app|messenger)\b)/gi;
const SIGNAL_CONTACT = /(\b(?:contact|message|text|reach|interview|chat|talk)\w*\b[^.]{0,40}?\b(?:on|via|through|using|over)\s+(?:the\s+)?)Signal\b/gi;
const SIGNAL_HANDLE = /\bSignal\b(?=[^.]{0,20}(@[\w.]+|\+?\d[\d\s().-]{6,}\d))/g;
const signalApp = (text) =>
  String(text ?? '')
    .replace(SIGNAL_NAMED, 'signalapp')
    .replace(SIGNAL_CONTACT, (m, lead, at, all) => (m.slice(lead.length) === 'Signal' && !/^\s+[A-Z]/.test(all.slice(at + m.length)) ? `${lead}signalapp` : m))
    .replace(SIGNAL_HANDLE, 'signalapp');
const OTHER_CHANNEL = /\b(apply (on|through|via|at|online)|careers? (site|page|portal)|application portal|our (site|website|portal)|e-?mail|phone|call us)\b|@[a-z0-9-]+\.[a-z]{2,}/i;

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
  if (employerFunded(chunk)) return false;
  if (PASSIVE_PAY.test(chunk) && !TRAVEL_OBJECT.test(chunk)) return true;
  const benefitClaim = STUDENT_PICKS.test(chunk) && ![OBLIGATION, VENDOR, FEE_OBJECT, STUDENT_COST].some((re) => re.test(chunk));
  for (const m of chunk.matchAll(PAY_VERB)) {
    const rest = chunk.slice(m.index);
    if (NOT_A_PAYMENT.test(rest)) continue;
    const before = chunk.slice(Math.max(0, m.index - 40), m.index);
    if (EMPLOYER_PAYS.test(before)) continue;
    const money = /^(send|wire)/i.test(m[0]) ? MONEY_OBJECT.test(rest) : true;
    if (!money || TRAVEL_OBJECT.test(rest)) continue;
    if (m.index === 0 && IMPERATIVE_FEE.test(rest)) return true;
    if (STUDENT_OBLIGED.test(before) || STUDENT_COST.test(chunk) || (!benefitClaim && REIMBURSE_AFTER.test(rest) && SOLD_OBJECT.test(rest))) return true;
    // "after you purchase the laptop from our approved vendor", "from our approved vendor you will purchase": buying
    // from the employer's vendor is the scam's ask.
    if (SPEND_VERB.test(m[0]) && VENDOR_NAMED.test(chunk)) return true;
  }
  return false;
}

// A sentence that spends a sent check: vendor or send-back wording, or a buy verb once the check is deposited, cashed
// or cleared, or from a place the employer names. A bare buy next to a bonus or stipend check is a benefit.
const DEPOSITED = /\b(deposit|cash)\s+(it|the\s+(check|cheque))\b|\b(after|once|when)\s+(it|the\s+(check|cheque))\s+clears\b/i;
const BUY_FROM_US = /\b(from|through|via|at|on)\s+(the\s+)?(link|site|store|website|portal|shop)\b[^.]{0,20}\b(we|our)\b|\bwe\s+(send|name|assign|choose|pick)\b/i;
const spendsCheck = (s, deposited) =>
  CHECK_SPEND.test(s) || (SPEND_VERB.test(s) && (deposited || BUY_FROM_US.test(s) || VENDOR.test(s)));
const fakeCheck = (list, i) => {
  if (!CHECK_SENT.test(list[i])) return false;
  const pair = [list[i], list[i + 1]].filter((s) => s !== undefined);
  const deposited = pair.some((s) => DEPOSITED.test(s));
  return pair.some((s) => spendsCheck(s, deposited));
};
const paymentAsked = (text) => {
  const list = chunks(text);
  return MONEY_ANY.test(text ?? '') || list.some((c, i) => studentPays(c) || fakeCheck(list, i));
};

// Chat-app contact counts only when the posting says it is the only channel, or names no other way to apply or reach it.
function chatOnly(raw) {
  const text = signalApp(raw);
  return CHAT_EXCLUSIVE.test(text) || (CHAT_CONTACT.test(text) && !OTHER_CHANNEL.test(text.replace(CHAT_CONTACT, '')));
}

// Company words' initials ("Example University Hospital" -> euh), for employers whose domain is an abbreviation.
const initials = (company) => String(company ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(of|the|and|inc|llc|co|corp)$/.test(w)).map((w) => w[0]).join('');

// Two initials are too loose as a prefix ("Capital One" -> co would pass corp-hiring.net), so two must match the whole
// label; three or more may start it.
const initialsMatch = (label, abbr) => (abbr.length >= 3 && label.startsWith(abbr)) || (abbr.length === 2 && label === abbr);

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
      if (label.includes(name.slice(0, 6)) || (label.length >= 3 && name.startsWith(label)) || initialsMatch(label, abbr)) continue;
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
