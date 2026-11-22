// Stub for M-004: contact stages and next actions for outreach. The implementer replaces these bodies.
export const STAGES = Object.freeze(['new', 'connected', 'chatting', 'rapport', 'referral-asked', 'referred', 'declined', 'closed']);
export const NUDGE_AFTER_DAYS = 5;
export const REFERRAL_AFTER_EXCHANGES = 2;
export const INVITE_WITHDRAW_DAYS = 21;
export function contactRecords(contactRows, actionRows) {
  void contactRows, actionRows;
  throw new Error('outreach-state: not implemented');
}
export function inviteAccepted(c) {
  void c;
  throw new Error('outreach-state: not implemented');
}
export function closedStage(c, nowMs, { inviteWithdrawDays = INVITE_WITHDRAW_DAYS, nudgeAfterDays = NUDGE_AFTER_DAYS } = {}) {
  void c, nowMs, inviteWithdrawDays, nudgeAfterDays;
  throw new Error('outreach-state: not implemented');
}
export function stageOf(c, nowMs) {
  void c, nowMs;
  throw new Error('outreach-state: not implemented');
}
export function nextAction(c, { nowMs, openPostings = new Set() }) {
  void c, nowMs, openPostings;
  throw new Error('outreach-state: not implemented');
}
export function oneActivePerCompany(due, contacts, nowMs) {
  void due, contacts, nowMs;
  throw new Error('outreach-state: not implemented');
}
export function weeklySent(actionRows, nowMs) {
  void actionRows, nowMs;
  throw new Error('outreach-state: not implemented');
}
export function followupsDue(actionRows, nowMs) {
  void actionRows, nowMs;
  throw new Error('outreach-state: not implemented');
}
