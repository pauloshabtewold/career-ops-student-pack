// Stub for M-004: outreach drafts through lib/headless.mjs. The implementer replaces these bodies.
export function sortReply(text) {
  void text;
  throw new Error('outreach-drafts: not implemented');
}
export function draftPrompt({ action, cv, contact, replyText = '', application = null }) {
  void action, cv, contact, replyText, application;
  throw new Error('outreach-drafts: not implemented');
}
export function draftJobs({ due, followups, replies = [], t6On }) {
  void due, followups, replies, t6On;
  throw new Error('outreach-drafts: not implemented');
}
export async function outreachDrafts({ paths, today, replies = [], deps = {}, say = console.log }) {
  void paths, today, replies, deps, say;
  throw new Error('outreach-drafts: not implemented');
}
