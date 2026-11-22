// Where each outreach contact stands, from data/contacts.tsv (date, company, name, stage) plus the budget action log.
// Outreach is warm first: an opener with no ask, replies answered, and a referral recommended only after two exchanges
// while the company has an open posting. A no, no answer to the one follow-up, or a connection request withdrawn or never
// accepted within INVITE_WITHDRAW_DAYS ends outreach to that person. closedStage() is the one close rule; budget.mjs runs it
// too, so the drafts and the send check agree on who still holds a company.
import { detailValue } from './action-log.mjs';
import { companyKey } from './company-key.mjs';

export const STAGES = Object.freeze(['new', 'connected', 'chatting', 'rapport', 'referral-asked', 'referred', 'declined', 'closed']);
const DAY_MS = 86400000;
export const NUDGE_AFTER_DAYS = 5;
export const REFERRAL_AFTER_EXCHANGES = 2;
// Matches budget.mjs invite_withdraw_days: an invite pending this long is withdrawn, so the contact is over.
export const INVITE_WITHDRAW_DAYS = 21;
const SENDS = ['linkedin.connect', 'linkedin.message', 'linkedin.nudge', 'gmail.send'];
const FOLLOWUP_MIN_DAYS = 7;
const FOLLOWUP_MAX_DAYS = 10;

// An email logged with --nudge is the contact's one follow-up, like linkedin.nudge.
const nudged = (r) => detailValue(r.detail, 'nudge') === '1';
// An email logged with --followup is an application's one follow-up (G6), never a contact.
const appFollowup = (r) => r.action === 'gmail.send' && detailValue(r.detail, 'followup') === '1';
// contacts.tsv stages that can only follow an accepted invite.
const SHEET_ACCEPTED = ['accepted', 'referral-ask', 'referred'];
const lower = (s) => String(s ?? '').trim().toLowerCase();
const keyOf = (name, company) => `${lower(name)}|${lower(company)}`;
const msOf = (r) => (Number.isFinite(r.ms) ? r.ms : Date.parse(r.ts));

// One record per contact (lowercased name plus company, on LinkedIn and by email alike) with the facts the stage is
// built from.
export function contactRecords(contactRows, actionRows) {
  const byKey = new Map();
  const get = (name, company) => {
    const key = keyOf(name, company);
    if (!byKey.has(key)) byKey.set(key, { name, company, sheetStage: null, sheetDate: null, sheetAccepted: false, connects: 0, lastConnect: -Infinity, accepts: [], withdrawn: false, messages: [], replies: [], nudges: [], declined: false });
    return byKey.get(key);
  };
  for (const r of contactRows) {
    if (!r.name || !r.company) continue;
    const c = get(r.name, r.company);
    // contacts.tsv holds one row per event, so the stage is the latest row's (by date, the later row on a tie).
    const date = String(r.date ?? '');
    if (c.sheetDate === null || date >= c.sheetDate) {
      c.sheetStage = r.stage;
      c.sheetDate = date;
    }
    if (SHEET_ACCEPTED.includes(r.stage)) c.sheetAccepted = true;
    // A connect row is an invite sent outside the action log, so it holds the person and the company like a logged one.
    // A row with no readable date leaves lastConnect alone and counts as an old invite.
    if (r.stage === 'connect') {
      c.connects++;
      const ms = Date.parse(date);
      if (Number.isFinite(ms)) c.lastConnect = Math.max(c.lastConnect, ms);
    }
  }
  for (const r of actionRows) {
    if (!r.target || !r.company || appFollowup(r)) continue;
    const c = get(r.target, r.company);
    const ms = msOf(r);
    if (r.action === 'linkedin.connect') {
      c.connects++;
      c.lastConnect = Math.max(c.lastConnect, ms);
    }
    if (r.action === 'linkedin.accept') c.accepts.push(ms);
    if (r.action === 'linkedin.message' || (r.action === 'gmail.send' && !nudged(r))) c.messages.push(ms);
    if (r.action === 'linkedin.reply') c.replies.push(ms);
    if (r.action === 'linkedin.nudge' || (r.action === 'gmail.send' && nudged(r))) c.nudges.push(ms);
    if (r.action === 'linkedin.declined') c.declined = true;
    if (r.action === 'linkedin.withdraw') c.withdrawn = true;
  }
  return [...byKey.values()];
}

// The invite was taken: an accepted (or later) contacts.tsv row, or a logged linkedin.accept, message or reply after the
// latest connect. A message or reply counts because the two are already talking, whatever the accept log says.
export function inviteAccepted(c) {
  const after = (ms) => ms >= c.lastConnect;
  return c.sheetAccepted || c.accepts.some(after) || c.messages.some(after) || c.replies.some(after);
}

// 'declined' or 'closed' when outreach to the contact is over, else null. Acceptance is checked before the withdraw and
// ignored-invite close, so a contact who accepted or is talking keeps the company however old the connect is; otherwise a
// withdrawn invite, or one pending for inviteWithdrawDays, ends the contact and frees the company. budget.mjs passes its
// invite_withdraw_days and nudge_min_days ceilings.
export function closedStage(c, nowMs, { inviteWithdrawDays = INVITE_WITHDRAW_DAYS, nudgeAfterDays = NUDGE_AFTER_DAYS } = {}) {
  if (c.declined) return 'declined';
  const lastReply = Math.max(-Infinity, ...c.replies);
  const lastNudge = Math.max(-Infinity, ...c.nudges);
  if (lastNudge > lastReply && nowMs - lastNudge >= nudgeAfterDays * DAY_MS) return 'closed';
  if (inviteAccepted(c)) return null;
  if (c.withdrawn) return 'closed';
  return c.connects && nowMs - c.lastConnect >= inviteWithdrawDays * DAY_MS ? 'closed' : null;
}

// Outreach stage of contact c at nowMs; a closed stage takes precedence.
export function stageOf(c, nowMs) {
  const closed = closedStage(c, nowMs);
  if (closed) return closed;
  if (c.sheetStage === 'referred') return 'referred';
  if (c.sheetStage === 'referral-ask') return 'referral-asked';
  if (c.replies.length >= REFERRAL_AFTER_EXCHANGES) return 'rapport';
  if (c.replies.length) return 'chatting';
  if (inviteAccepted(c) || c.messages.length) return 'connected';
  return 'new';
}

// True when openPostings (company names, lowercase names or company keys) holds the contact's company.
const hasPosting = (openPostings, company) => openPostings.has(company) || openPostings.has(lower(company)) || openPostings.has(companyKey(String(company ?? '')));

// The next thing to do for a contact: { stage, action } with action connect, wait, warm-opener, reply, referral-ask,
// follow-up or stop. An unanswered reply comes before an opener, so a contact who wrote first gets an answer.
export function nextAction(c, { nowMs, openPostings = new Set() }) {
  const stage = stageOf(c, nowMs);
  if (['declined', 'closed', 'referred', 'referral-asked'].includes(stage)) return { stage, action: 'stop' };
  const lastReply = Math.max(-Infinity, ...c.replies);
  const lastSent = Math.max(-Infinity, ...c.messages, ...c.nudges);
  if (stage === 'new') return { stage, action: c.connects ? 'wait' : 'connect' };
  if (lastReply > lastSent) {
    if (stage === 'rapport' && hasPosting(openPostings, c.company)) return { stage, action: 'referral-ask' };
    return { stage, action: 'reply' };
  }
  if (!c.messages.length) return { stage, action: 'warm-opener' };
  if (!c.nudges.length && !c.replies.length && nowMs - lastSent >= NUDGE_AFTER_DAYS * DAY_MS) return { stage, action: 'follow-up' };
  return { stage, action: 'wait' };
}

// A contact counts as active from their first send until they decline, go silent after the follow-up, or their invite is
// withdrawn or left unaccepted for INVITE_WITHDRAW_DAYS.
const isActive = (c, nowMs) => Boolean(c.connects || c.messages.length || c.nudges.length || c.replies.length) && !['declined', 'closed'].includes(stageOf(c, nowMs));
const OPENERS = ['connect', 'warm-opener'];

// One active contact per company (G2): an opener for a new contact is held back while another contact at the same company
// is active, and only the first new contact of a company gets one, so a batch carries no draft budget.mjs will refuse.
export function oneActivePerCompany(due, contacts, nowMs) {
  const busy = new Set(contacts.filter((c) => isActive(c, nowMs)).map((c) => lower(c.company)));
  return due.filter((d) => {
    if (!OPENERS.includes(d.action)) return true;
    const company = lower(d.company);
    const mine = contacts.find((c) => keyOf(c.name, c.company) === keyOf(d.name, d.company));
    if (mine && isActive(mine, nowMs)) return true;
    if (busy.has(company)) return false;
    busy.add(company);
    return true;
  });
}

// Sends of every outreach kind in the rolling 7 days, split by kind.
export function weeklySentBy(actionRows, nowMs) {
  const week = actionRows.filter((r) => SENDS.includes(r.action) && !appFollowup(r) && msOf(r) > nowMs - 7 * DAY_MS && msOf(r) <= nowMs);
  const by = (a) => week.filter((r) => r.action === a).length;
  return { total: week.length, connects: by('linkedin.connect'), messages: by('linkedin.message') + by('linkedin.nudge'), emails: by('gmail.send') };
}

// The weekly outreach sent count for the digest.
export const weeklySent = (actionRows, nowMs) => weeklySentBy(actionRows, nowMs).total;

// An application is the --target and --company of its apply.submit row.
const appKey = (r) => keyOf(r.target, r.company);

// Follow-ups due on submitted applications: 7 to 10 days after the submit and none sent yet (G6), one per application.
export function followupsDue(actionRows, nowMs) {
  const done = new Set(actionRows.filter((r) => r.action === 'apply.followup' || appFollowup(r)).map(appKey));
  const seen = new Set();
  const out = [];
  for (const r of actionRows) {
    if (!(r.action === 'apply.submit' || r.action === 'apply.easy_apply') || !r.target) continue;
    const key = appKey(r);
    if (done.has(key) || seen.has(key)) continue;
    const days = (nowMs - msOf(r)) / DAY_MS;
    if (days < FOLLOWUP_MIN_DAYS || days > FOLLOWUP_MAX_DAYS) continue;
    seen.add(key);
    out.push({ target: r.target, company: r.company, submitted: r.date });
  }
  return out;
}
