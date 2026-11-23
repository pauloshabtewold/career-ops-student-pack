// Stub for M-005: outcome phrase rules, sender-domain match and the T7 outcome decision.
export const OUTCOMES = Object.freeze({ rejection: 'Rejected', interview: 'Interview', offer: 'Offer' });

export function phraseClass(text) {
  throw new Error('not implemented');
}

export function domainMatches(from, company) {
  throw new Error('not implemented');
}

export async function decideOutcome(mail, company, { t7On = false, classify = null } = {}) {
  throw new Error('not implemented');
}
