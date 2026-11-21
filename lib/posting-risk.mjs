// Stub for M-003: scam and ghost signals. The implementer replaces these bodies.
export const REPOST_MAX = 3;
export const AGE_DAYS_MAX = 60;
export function riskRules({ text, company, repostCount = 0, ageDays = 0 }) {
  void text, company, repostCount, ageDays;
  throw new Error('posting-risk: not implemented');
}
export const isRisky = (rules) => {
  void rules;
  throw new Error('posting-risk: not implemented');
};
export const riskReason = (rules) => {
  void rules;
  throw new Error('posting-risk: not implemented');
};
