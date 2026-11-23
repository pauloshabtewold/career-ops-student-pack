#!/usr/bin/env node
// Hard budget ceilings for LinkedIn, Handshake, applications, unattended runs and discovery.
// CEILINGS is frozen and nothing reads the environment: config limits can only tighten a ceiling, and every
// clamp of a looser value is logged. compat.json carries this file's SHA-256 (scripts/compat-hash.mjs).
// Model-usage triage is not a ceiling here: the student owns that budget (lib/triage-budget.mjs).
// Every irreversible send kind (submits, LinkedIn sends, emails and application follow-ups) also needs its item in a batch
// the student approved: `log batch.approve` records the approval in the student's words, and a check of a send kind passes
// only for a listed item not yet sent by any kind (approvedItem). Outreach hygiene (one active contact per company, one
// first message per person, nothing after a no or an unanswered follow-up) uses closedStage() from lib/outreach-state.mjs,
// the same close rule outreach-state due follows.
// Exit codes: 0 ok, 2 usage, 3 refused, 4 wait, 5 needs the user.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, runCli, UsageError, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { parseConfig, ConfigError, deepFreeze } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { LOG_HEADER, appendAction, readActionLog, detailValue } from '../lib/action-log.mjs';
import { withLock } from '../lib/dir-lock.mjs';
import { readBatch } from '../lib/batch-file.mjs';
import { FOLLOWUP_MAX_DAYS, FOLLOWUP_MIN_DAYS, closedStage, contactRecords, isAppFollowup, isMessage, isNudge, lower, withPendingSends } from '../lib/outreach-state.mjs';
import { escapeCell, readTsv } from '../lib/tsv.mjs';

const entry = (value, unit, tighten, period) => ({ value, unit, tighten, period });
const down = (value, unit, period) => entry(value, unit, 'down', period);
const up = (value, unit, period) => entry(value, unit, 'up', period);

export const CEILINGS = deepFreeze({
  // LinkedIn
  connect_per_day: down(20, 'count', 'day'),
  connect_per_rolling_7d: down(100, 'count', 'rolling-7d'),
  pending_invites_max: down(200, 'count', 'standing'),
  message_per_day: down(10, 'count', 'day'),
  profile_view_per_day: down(60, 'count', 'day'),
  search_page_per_session: down(8, 'count', 'session'),
  gap_min_s: up(45, 'seconds', 'action'),
  gap_max_s: down(120, 'seconds', 'action'),
  window_start: up('08:00', 'time', 'day'),
  window_end: down('22:00', 'time', 'day'),
  contacts_per_company: down(3, 'count', 'company'),
  contacts_active_per_company: down(1, 'count', 'company'),
  first_message_per_target: down(1, 'count', 'target'),
  nudge_per_target: down(1, 'count', 'target'),
  nudge_min_days: up(5, 'days', 'target'),
  notes_free_per_rolling_7d: down(2, 'count', 'rolling-7d'),
  note_len_free: down(200, 'chars', 'note'),
  note_len_premium: down(300, 'chars', 'note'),
  opener_len: down(299, 'chars', 'message'),
  invite_withdraw_days: down(21, 'days', 'invite'),
  rounds_per_day: down(1, 'count', 'day'),
  linkedin_fresh_search_per_hour: down(1, 'count', 'hour'),
  // Applications
  submit_per_day: down(10, 'count', 'day'),
  first_week_submit_per_session: down(3, 'count', 'session'),
  first_week_days: down(7, 'days', 'once'),
  batch_size: down(3, 'count', 'batch'),
  approval_batch_max: down(10, 'count', 'batch'),
  easy_apply_per_day: down(12, 'count', 'day'),
  score_floor: up(3.5, 'score', 'submit'),
  per_company_per_day: down(2, 'count', 'day'),
  jd_browser_per_session: down(10, 'count', 'session'),
  tracks_per_company: down(1, 'count', 'company'),
  // Handshake
  pages_per_search_per_session: down(4, 'count', 'search'),
  // Unattended
  run_lock_hours: down(12, 'hours', 'run'),
  apply_session_lock_hours: down(6, 'hours', 'run'),
  snapshots_kept: down(7, 'count', 'run'),
  inbox_lookback_days: down(2, 'days', 'run'),
  notifications_per_run: down(5, 'count', 'run'),
  triage_audit_weekly: down(20, 'count', 'week'),
  liveness_batch: down(50, 'count', 'run'),
  // Only tightens, like every ceiling: lever T2's cheaper pre-screen makes no final score for a top or borderline row,
  // so it runs under this floor, and no lever verdict lowers it.
  triage_tier_min: up('standard', 'tier', 'run'),
  // Discovery
  request_gap_ms: up(1200, 'ms', 'request'),
  crawl_delay_cap_s: up(5, 'seconds', 'request'),
  backoff_ms_per_attempt: up(3000, 'ms', 'attempt'),
  pages_per_site_search: down(5, 'count', 'search'),
  aggregator_in_flight: down(4, 'count', 'run'),
  github_discovery_period: entry('monthly', 'period', 'up', 'run'),
  github_new_trials_per_run: down(3, 'count', 'run'),
  github_min_active_per_kind: up(2, 'count', 'run'),
  github_push_window_days: down(14, 'days', 'run'),
  github_retire_days: down(30, 'days', 'run'),
  github_failed_parses: down(3, 'count', 'run'),
  never_fetch_hosts: entry(['linkedin.com'], 'hosts', 'up', 'always'),
});

const DAY_MS = 86400000;
const LINKEDIN_SENDS = ['linkedin.connect', 'linkedin.message', 'linkedin.nudge'];
const CHECKABLE = [
  ...LINKEDIN_SENDS,
  'linkedin.profile_view',
  'linkedin.search_page',
  'linkedin.withdraw',
  'linkedin.fresh_search',
  'handshake.page',
  'apply.submit',
  'apply.easy_apply',
  'apply.followup',
  'gmail.send',
  'apply.jd_browser',
];
// Events recorded as they happen; they are not budgeted and carry no gap.
// linkedin.reply and linkedin.declined record what a contact did, so hygiene rules can stop after a no or a silence.
// apply.pending is logged by chrome.mjs right before a submit click, and gmail.pending by lib/gmail-chrome.mjs right
// before a Send click, so an item stays used even when the send log after the click fails.
const OBSERVED = ['linkedin.accept', 'linkedin.reply', 'linkedin.declined', 'apply.track-confirm', 'apply.policy', 'batch.approve', 'apply.pending', 'gmail.pending'];
const PENDING = ['apply.pending', 'gmail.pending'];
// Send kinds whose check needs a logged, unused approved batch item. A follow-up is checked as apply.followup and as its
// channel (gmail.send with --followup) with the same batch item; both checks run before either is logged.
const SEND_KINDS = ['apply.submit', 'apply.easy_apply', ...LINKEDIN_SENDS, 'gmail.send', 'apply.followup'];
const APPROVAL_RE = /^(send|submit) (all|\d+(,\s*\d+)*)$/;
// apply.submit carries --batch-id and --item instead of approval words; its approval is the logged batch.approve.
const NEEDS_APPROVAL = [...LINKEDIN_SENDS];
const EXIT = { ok: 0, refused: 3, wait: 4, 'needs-user': 5 };

// Easy Apply happens on LinkedIn, so it shares LinkedIn's window, gap and warning stop.
const groupOf = (action) => (action.startsWith('linkedin.') || action === 'apply.easy_apply' ? 'linkedin' : action.startsWith('handshake.') ? 'handshake' : null);
const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// Effective limits: a configured number may only tighten its ceiling. Looser values are reported as clamps.
export function effectiveLimits(config = {}) {
  const configured = { ...(config.limits ?? {}) };
  if (typeof config.score_floor === 'number') configured.score_floor = Math.max(config.score_floor, configured.score_floor ?? -Infinity);
  const values = Object.fromEntries(Object.entries(CEILINGS).map(([k, e]) => [k, e.value]));
  const clamps = [];
  for (const [key, cfg] of Object.entries(configured)) {
    const ceiling = CEILINGS[key];
    if (!ceiling || typeof ceiling.value !== 'number' || typeof cfg !== 'number' || !Number.isFinite(cfg)) continue;
    const looser = ceiling.tighten === 'down' ? cfg > ceiling.value : cfg < ceiling.value;
    if (looser) clamps.push({ key, configured: cfg, ceiling: ceiling.value });
    else values[key] = cfg;
  }
  return { values, clamps };
}

// Random gap between LinkedIn actions, drawn uniformly in [gap_min_s, gap_max_s] by the given rng at log time.
export function drawGapMs(config, rng) {
  const { values } = effectiveLimits(config);
  const max = Math.max(values.gap_max_s, values.gap_min_s);
  return Math.round((values.gap_min_s + rng() * (max - values.gap_min_s)) * 1000);
}

const result = (status, reason, extra = {}) => ({ status, reason, remaining: null, earliest: null, ...extra });

function makeContext({ action, args, history, contacts = [], config, session, now }) {
  const { values: L } = effectiveLimits(config);
  const local = createClock({ timezone: config.timezone }).localTime(now);
  const nowMs = now.getTime();
  // A gmail.pending row with no gmail.send counts as that email for every rule, except the item checked or logged now.
  const rows = withPendingSends(history, `${args.batchId}#${args.item}`).map((r) => ({ ...r, ms: r.ms ?? Date.parse(r.ts) }));
  const remainingFrom = [];
  const refuse = (reason, extra = {}) => result('refused', reason, { period: 'day', ...extra });
  const cap = (limit, used, what) => {
    if (used >= limit) return refuse(`${what}: ${used} of ${limit} used`);
    remainingFrom.push(limit - used - 1);
    return null;
  };
  return {
    action, args, config, session, L, local, nowMs, rows, contacts, remainingFrom, refuse, cap,
    group: groupOf(action),
    count: (pred) => rows.filter(pred).length,
    isToday: (r) => r.date === local.date,
    inWeek: (r) => r.ms > nowMs - 7 * DAY_MS && r.ms <= nowMs,
  };
}

// Outreach drafts or off stops every outreach send, LinkedIn and email alike. An application follow-up email
// (gmail.send --followup) belongs to the apply side and is left alone.
function switchRefusal({ group, config, action, args, refuse }) {
  const switches = config.switches ?? {};
  if (group === 'handshake' && switches.handshake === 'off') return refuse('handshake is switched off', { period: 'day' });
  const outreachSend = LINKEDIN_SENDS.includes(action) || (action === 'gmail.send' && !args.followup);
  if (outreachSend && switches.outreach !== undefined && switches.outreach !== 'on') {
    return refuse(`outreach is ${switches.outreach}; sends are disabled`);
  }
  return null;
}

function warningRefusal({ group, rows, isToday, refuse }) {
  if (group && rows.some((r) => r.action === `${group}.warning` && isToday(r))) {
    return refuse(`${group} warning logged today; no ${group} actions until the next local day`, { scope: group });
  }
  return null;
}

function priorRefusal({ action, group, rows, session, isToday, refuse }) {
  const prior = rows.find(
    (r) => r.action === 'budget.refusal' && (r.target === action || r.target === group) && (detailValue(r.detail, 'period') === 'session' ? r.session === session : isToday(r)),
  );
  if (!prior) return null;
  const why = /reason=(.*)$/.exec(prior.detail ?? '')?.[1] ?? 'earlier refusal';
  return refuse(`${action} already refused in this period: ${why}`, { repeat: true, period: detailValue(prior.detail, 'period') ?? 'day' });
}

// A log of apply.easy_apply records a click that already happened: chrome.mjs checked the window before the click, so a
// click at 21:59 whose log lands at 22:00 is still logged rather than refused.
function windowRefusal({ action, args, group, local, refuse }) {
  if (group !== 'linkedin' || (action === 'apply.easy_apply' && args.recheck)) return null;
  const mins = local.hour * 60 + local.minute;
  if (mins < toMinutes(CEILINGS.window_start.value) || mins >= toMinutes(CEILINGS.window_end.value)) {
    return refuse('outside the LinkedIn window of 08:00 to 22:00 local time', { scope: 'linkedin' });
  }
  return null;
}

const PREFLIGHT = [switchRefusal, warningRefusal, priorRefusal, windowRefusal];

function pendingRefusal({ args, L, refuse }) {
  if (typeof args.pending !== 'number') return refuse('pending invite count missing; pass --pending');
  if (args.pending > L.pending_invites_max) return refuse(`${args.pending} pending invites exceed ${L.pending_invites_max}`, { period: 'standing' });
  return null;
}

function noteRule({ args, config, L, refuse, cap, inWeek }, connects) {
  if (!(args.length > 0)) return null;
  const tier = config.linkedin_tier === 'premium' && args.tier !== 'free' ? 'premium' : 'free';
  const limit = tier === 'premium' ? L.note_len_premium : L.note_len_free;
  if (args.length > limit) return refuse(`note of ${args.length} characters exceeds ${limit} on the ${tier} tier`);
  if (tier !== 'free') return null;
  const notes = connects.filter((r) => inWeek(r) && Number(detailValue(r.detail, 'note')) > 0).length;
  return cap(L.notes_free_per_rolling_7d, notes, 'connection notes in the rolling 7 days');
}

function connectRule(ctx) {
  const { args, L, rows, isToday, inWeek, cap } = ctx;
  const connects = rows.filter((r) => r.action === 'linkedin.connect');
  const pending = args.recheck ? null : pendingRefusal(ctx);
  if (pending) return pending;
  const stop =
    cap(L.connect_per_day, connects.filter(isToday).length, 'connect requests today') ||
    cap(L.connect_per_rolling_7d, connects.filter(inWeek).length, 'connect requests in the rolling 7 days') ||
    companyCap(rows, args, L.contacts_per_company, cap) ||
    hygieneRefusal(ctx, 'linkedin.connect');
  return stop || noteRule(ctx, connects);
}

// Email is outreach too: a gmail.send is keyed by the contact's name (--target, with the address in --email), and one sent
// with --nudge is that contact's one follow-up, so the hygiene rules below see both channels as one person. One sent with
// --followup is an application's one follow-up (G6): it is no outreach contact, and the person rules never see it.
const OUTREACH_SENDS = [...LINKEDIN_SENDS, 'gmail.send'];
// A person is their lowercased name plus lowercased company, the key lib/outreach-state.mjs uses. A check without
// --company matches the name at any company, so leaving the flag out never opens a second message.
const sameCompany = (company) => (r) => !lower(company) || lower(r.company) === lower(company);
const personRows = (rows, target, company) => rows.filter((r) => !isAppFollowup(r) && lower(r.target) === lower(target) && sameCompany(company)(r));
const personSheet = (contacts, target, company) => contacts.filter((r) => lower(r.name) === lower(target) && sameCompany(company)(r));

// Outreach hygiene, per person, so a refusal is unlogged and other contacts stay open: a contact who said no or stayed
// silent after the one follow-up is never messaged again, one person gets one first message, nobody is invited twice, and
// a company has at most contacts_active_per_company contacts in progress at a time.
function hygieneRefusal(ctx, action) {
  const { args, L, rows, contacts, nowMs, refuse } = ctx;
  if (!args.target) return null;
  const mine = personRows(rows, args.target, args.company);
  if (mine.some((r) => r.action === 'linkedin.declined')) return refuse(`${args.target} declined; no more messages`, { unlogged: true });
  const lastReply = Math.max(-Infinity, ...mine.filter((r) => r.action === 'linkedin.reply').map((r) => r.ms));
  const nudge = Math.max(-Infinity, ...mine.filter(isNudge).map((r) => r.ms));
  if (nudge > lastReply && nowMs - nudge >= L.nudge_min_days * DAY_MS) return refuse(`${args.target} did not answer the follow-up; outreach to them has stopped`, { unlogged: true });
  // Once invited, never again: a connect in the action log or a contacts.tsv connect row refuses a second request to the
  // same person whatever their stage (declined, withdrawn, ignored or accepted).
  const sheetConnect = personSheet(contacts, args.target, args.company).some((r) => r.stage === 'connect');
  if (action === 'linkedin.connect' && (sheetConnect || mine.some((r) => r.action === 'linkedin.connect'))) {
    return refuse(`${args.target} already had a connection request; never invite the same person twice`, { unlogged: true });
  }
  if (action === 'linkedin.message' || action === 'gmail.send') {
    const firsts = mine.filter(isMessage).length;
    if (lastReply === -Infinity && firsts >= L.first_message_per_target) return refuse(`${args.target} already has a first message with no reply`, { unlogged: true });
  }
  return activeCompanyRefusal(ctx);
}

// A contact is active from the first send on either channel, or a contacts.tsv connect row, until closedStage() from
// lib/outreach-state.mjs ends them. Each contact is built from their contacts.tsv rows and action-log rows together, so an
// invite or accept recorded only in the sheet counts here too.
function activeCompanyRefusal({ args, L, rows, contacts, nowMs, refuse }) {
  if (!args.company) return null;
  const atCompany = (r) => lower(r.company) === lower(args.company);
  const sends = rows.filter((r) => OUTREACH_SENDS.includes(r.action) && !isAppFollowup(r) && atCompany(r));
  const names = [...sends.map((r) => r.target), ...contacts.filter((r) => r.stage === 'connect' && atCompany(r)).map((r) => r.name)];
  const others = [...new Map(names.filter(Boolean).map((t) => [lower(t), t])).entries()].filter(([k]) => k !== lower(args.target)).map(([, t]) => t);
  const open = (t) => {
    const [contact] = contactRecords(personSheet(contacts, t, args.company), personRows(rows, t, args.company));
    return contact && !closedStage(contact, nowMs, { inviteWithdrawDays: L.invite_withdraw_days, nudgeAfterDays: L.nudge_min_days });
  };
  const active = others.filter(open);
  return active.length >= L.contacts_active_per_company ? refuse(`${args.company} already has an active contact (${active[0]}); one at a time`, { unlogged: true }) : null;
}

function messageRule(ctx) {
  const { args, L, rows, count, isToday, refuse, cap } = ctx;
  const stop = cap(L.message_per_day, count((r) => r.action === 'linkedin.message' && isToday(r)), 'messages today') || companyCap(rows, args, L.contacts_per_company, cap) || hygieneRefusal(ctx, 'linkedin.message');
  if (stop) return stop;
  const first = !rows.some((r) => r.action === 'linkedin.message' && r.target === args.target);
  return first && args.length > L.opener_len ? refuse(`first message of ${args.length} characters exceeds ${L.opener_len}`) : null;
}

// One follow-up per submitted application, 7 to 10 days after its apply.submit. An application is the --target (and,
// when given, --company) of its apply.submit row.
function followupRule({ args, rows, nowMs, refuse }) {
  if (!args.target) return refuse('target missing; pass --target with the application url', { unlogged: true });
  const app = (r) => lower(r.target) === lower(args.target) && sameCompany(args.company)(r);
  const submit = Math.min(Infinity, ...rows.filter((r) => (r.action === 'apply.submit' || r.action === 'apply.easy_apply') && app(r)).map((r) => r.ms));
  if (submit === Infinity) return refuse(`no logged submit for ${args.target}`, { unlogged: true });
  // Only apply.followup rows count here: its gmail.send --followup twin is logged first for the same send.
  if (rows.some((r) => r.action === 'apply.followup' && app(r))) return refuse(`${args.target} already had its one follow-up`, { unlogged: true });
  const days = (nowMs - submit) / DAY_MS;
  if (days < FOLLOWUP_MIN_DAYS) return refuse(`follow-up is due ${FOLLOWUP_MIN_DAYS} days after the submit; ${Math.floor(days)} have passed`, { unlogged: true });
  if (days > FOLLOWUP_MAX_DAYS) return refuse(`the follow-up window closed ${FOLLOWUP_MAX_DAYS} days after the submit`, { unlogged: true });
  return null;
}

// A nudge follows up an earlier message to the same person, so a nudge with no first message is refused, and it keeps
// the one-active-contact-per-company rule like any other send.
function nudgeRule(ctx) {
  const { args, L, rows, nowMs, refuse, cap } = ctx;
  const mine = personRows(rows, args.target, args.company);
  if (mine.some((r) => r.action === 'linkedin.declined')) return refuse(`${args.target} declined; no more messages`, { unlogged: true });
  const stop = cap(L.nudge_per_target, mine.filter(isNudge).length, 'nudges to this target') || companyCap(rows, args, L.contacts_per_company, cap);
  if (stop) return stop;
  const lastMsg = Math.max(-Infinity, ...mine.filter(isMessage).map((r) => r.ms));
  if (lastMsg === -Infinity) return refuse(`${args.target} has no first message to follow up`, { unlogged: true });
  if (nowMs - lastMsg < L.nudge_min_days * DAY_MS) return refuse(`last message to this target is under ${L.nudge_min_days} days old`);
  return activeCompanyRefusal(ctx);
}

// Addresses logged on emails to contacts who declined.
function declinedEmails(rows) {
  const declined = new Set(rows.filter((r) => r.action === 'linkedin.declined').map((r) => `${lower(r.target)}|${lower(r.company)}`));
  return new Set(rows.filter((r) => r.action === 'gmail.send' && !isAppFollowup(r) && declined.has(`${lower(r.target)}|${lower(r.company)}`)).map((r) => lower(detailValue(r.detail, 'email'))).filter(Boolean));
}

// An email: --followup makes it an application's one follow-up (the apply.followup rules: a logged submit, 7 to 10 days
// after it, once per application; no person rules), --nudge a contact's one follow-up (nudge rules), anything else a
// message to a contact (hygiene rules). No email goes to an address logged for a contact who declined.
function gmailRule(ctx) {
  const { args, rows, refuse } = ctx;
  if (args.email && declinedEmails(rows).has(lower(args.email))) return refuse(`${args.email} belongs to a contact who declined; no more messages`, { unlogged: true });
  if (args.followup) {
    const app = (r) => lower(r.target) === lower(args.target) && sameCompany(args.company)(r);
    if (rows.some((r) => isAppFollowup(r) && app(r))) return refuse(`${args.target} already had its follow-up email`, { unlogged: true });
    return followupRule(ctx);
  }
  if (!args.target) return refuse('target missing; pass --target with the contact name and --email with the address', { unlogged: true });
  return args.nudge ? nudgeRule(ctx) : hygieneRefusal(ctx, 'gmail.send');
}

function sessionCap({ cap }, limit, used, what) {
  const stop = cap(limit, used, what);
  if (stop) stop.period = 'session';
  return stop;
}

function handshakePageRule(ctx) {
  const { action, args, L, session, count, refuse } = ctx;
  if (!args.search) return refuse('search id missing; pass --search');
  const used = count((r) => r.action === action && r.session === session && (detailValue(r.detail, 'search') ?? r.target) === args.search);
  return sessionCap(ctx, L.pages_per_search_per_session, used, 'handshake pages for this search');
}

const HOUR_MS = 3600000;
const FRESH_SPACING_MS = 50 * 60000;

// One past-hour saved-search page per local clock hour, and at least 50 minutes after the last read. The hourly scan
// waits up to 10 minutes of jitter inside its own clock hour, so its reads land 50 to 70 minutes apart; a rolling 60
// minutes would refuse about a third of them. The count per clock hour, and so per day, is unchanged.
function freshSearchRule({ action, L, rows, nowMs, config, local }) {
  const clock = createClock({ timezone: config.timezone });
  const hourOf = (ms) => {
    const t = clock.localTime(new Date(ms));
    return `${t.date}T${t.hour}`;
  };
  const reads = rows.filter((r) => r.action === action).map((r) => r.ms).sort((a, b) => a - b);
  const thisHour = reads.filter((ms) => hourOf(ms) === `${local.date}T${local.hour}`);
  const spaced = reads.filter((ms) => ms > nowMs - FRESH_SPACING_MS);
  const limit = L.linkedin_fresh_search_per_hour;
  if (thisHour.length < limit && spaced.length < limit) return null;
  const nextHour = nowMs - (nowMs % 60000) + (60 - local.minute) * 60000;
  const afterSpacing = spaced.length >= limit ? spaced[spaced.length - limit] + FRESH_SPACING_MS : 0;
  const earliest = new Date(Math.max(thisHour.length >= limit ? nextHour : 0, afterSpacing)).toISOString();
  return result('wait', `fresh search: ${Math.max(thisHour.length, spaced.length)} of ${limit} this hour; earliest ${earliest}`, { earliest });
}

// Easy Apply keeps its own daily cap on top of every submit rule. It also counts inside submit_per_day: chrome.mjs logs
// an apply.pending row before every click, Easy Apply included, and submitRows counts a pending row that has no
// apply.submit. The score floor applies when --score is given; chrome.mjs submit always passes the fill plan's score.
function easyApplyRule(ctx) {
  const { action, args, L, count, isToday, cap } = ctx;
  const scored = typeof args.score === 'number' ? ctx : { ...ctx, args: { ...args, recheck: true } };
  return cap(L.easy_apply_per_day, count((r) => r.action === action && isToday(r)), 'Easy Apply submits today') || submitRules(scored);
}

const ACTION_RULES = {
  'linkedin.connect': connectRule,
  'linkedin.message': messageRule,
  'linkedin.nudge': nudgeRule,
  'linkedin.profile_view': (c) => c.cap(c.L.profile_view_per_day, c.count((r) => r.action === c.action && c.isToday(r)), 'profile views today'),
  'linkedin.search_page': (c) => sessionCap(c, c.L.search_page_per_session, c.count((r) => r.action === c.action && r.session === c.session), 'search pages this session'),
  'handshake.page': handshakePageRule,
  'apply.jd_browser': (c) => sessionCap(c, c.L.jd_browser_per_session, c.count((r) => r.action === c.action && r.session === c.session), 'browser job descriptions this session'),
  'apply.submit': submitRules,
  'linkedin.fresh_search': freshSearchRule,
  'apply.easy_apply': easyApplyRule,
  'apply.followup': followupRule,
  'gmail.send': gmailRule,
};

function gapOrOk({ group, rows, nowMs, remainingFrom }) {
  if (group === 'linkedin') {
    const next = Math.max(-Infinity, ...rows.filter((r) => groupOf(r.action) === 'linkedin').map((r) => Date.parse(detailValue(r.detail, 'next_allowed') ?? '')).filter(Number.isFinite));
    if (next > nowMs) return result('wait', `LinkedIn gap not elapsed; earliest ${new Date(next).toISOString()}`, { earliest: new Date(next).toISOString() });
  }
  return result('ok', 'within budget', { remaining: remainingFrom.length ? Math.min(...remainingFrom) : null });
}

const listOf = (text) => String(text ?? '').split(',').map((n) => Number(n.trim())).filter(Number.isInteger);

// True only when a logged batch.approve for batchId lists item and no send or pending row was logged yet for that batch-id
// and item. One function serves every send kind, so an approval is spent once in total, across kinds.
export function approvedItem(rows, batchId, item) {
  if (!batchId || !Number.isInteger(item)) return false;
  const approved = rows.some((r) => r.action === 'batch.approve' && detailValue(r.detail, 'batch') === batchId && listOf(detailValue(r.detail, 'items')).includes(item));
  const used = rows.some((r) => (SEND_KINDS.includes(r.action) || PENDING.includes(r.action)) && detailValue(r.detail, 'batch') === batchId && Number(detailValue(r.detail, 'item')) === item);
  return approved && !used;
}

// A missing approval refuses this one item only: it is marked unlogged so it does not write a budget.refusal row that
// would stop every other approved item for the rest of the day. batch is the stored batch (data/batches/<id>.json) when
// it exists: an item that names a target is spent only on that target, so an approval for one person never sends to another.
function approvalRefusal({ action, args = {}, history = [], batch = null }) {
  if (!SEND_KINDS.includes(action) || args.recheck) return null;
  const refuse = (reason) => result('refused', reason, { period: 'day', unlogged: true });
  if (!args.batchId || !Number.isInteger(args.item)) return refuse(`${action} needs --batch-id and --item from an approved batch`);
  if (!approvedItem(history, args.batchId, args.item)) return refuse(`item ${args.item} of batch ${args.batchId} has no unused logged approval`);
  if (!batch) return null;
  const listed = batch.items?.[args.item - 1];
  if (!listed) return refuse(`batch ${args.batchId} has no item ${args.item}`);
  if (listed.target && lower(listed.target) !== lower(args.target)) return refuse(`item ${args.item} of batch ${args.batchId} was approved for ${listed.target}, not ${args.target ?? '(no target)'}`);
  return null;
}

// The CLI check: a send kind first needs its approved, unused batch item (bound to its target), then the ceilings decide.
// evaluate() stays the ceiling decision alone.
export function evaluateCheck(opts) {
  return approvalRefusal(opts) ?? evaluate(opts);
}

/** Decides one action. history is the action-log rows, contacts the data/contacts.tsv rows; gaps are drawn at log time, not here. */
export function evaluate({ action, args = {}, history = [], contacts = [], config = {}, session = '', now = createClock({ timezone: config.timezone }).now() }) {
  const ctx = makeContext({ action, args, history, contacts, config, session, now });
  if (!CHECKABLE.includes(action)) return ctx.refuse(`unknown action ${action}`);
  for (const check of PREFLIGHT) {
    const refusal = check(ctx);
    if (refusal) return refusal;
  }
  return ACTION_RULES[action]?.(ctx) || gapOrOk(ctx);
}

function companyCap(rows, args, limit, cap) {
  if (!args.company) return null;
  const contacted = new Set(
    rows.filter((r) => LINKEDIN_SENDS.includes(r.action) && r.company === args.company).map((r) => r.target),
  );
  if (contacted.has(args.target)) return null;
  return cap(limit, contacted.size, `targets contacted at ${args.company}`);
}

// A submit is an apply.submit row, or an apply.pending row with no apply.submit for its batch item: a click whose log
// never ran still counts against every submit cap. The item being checked or logged now is not counted twice.
const itemKey = (r) => `${detailValue(r.detail, 'batch')}#${detailValue(r.detail, 'item')}`;
function submitRows(rows, args) {
  const logged = new Set(rows.filter((r) => r.action === 'apply.submit').map(itemKey));
  const current = `${args.batchId}#${args.item}`;
  return rows.filter((r) => r.action === 'apply.submit' || (r.action === 'apply.pending' && !logged.has(itemKey(r)) && itemKey(r) !== current));
}

function submitRules({ rows, args, config, L, session, nowMs, isToday, cap, refuse }) {
  const submits = submitRows(rows, args);
  const company = (args.company ?? '').toLowerCase();
  const sameCompany = submits.filter((r) => (r.company ?? '').toLowerCase() === company);
  if (args.batch > L.batch_size) return refuse(`batch of ${args.batch} exceeds ${L.batch_size}`);
  if (!args.recheck) {
    if (typeof args.score !== 'number') return refuse('score missing; pass --score');
    if (args.score < L.score_floor) return refuse(`score ${args.score} is below the floor of ${L.score_floor}`);
  }
  const stop =
    cap(L.submit_per_day, submits.filter(isToday).length, 'submits today') ||
    cap(L.per_company_per_day, sameCompany.filter(isToday).length, `submits to ${args.company} today`);
  if (stop) return stop;
  const first = Math.min(Infinity, ...submits.map((r) => r.ms));
  if (nowMs - first < L.first_week_days * DAY_MS) {
    const inSession = submits.filter((r) => r.session === session).length;
    if (inSession >= L.first_week_submit_per_session) {
      return { ...refuse(`first week: ${inSession} of ${L.first_week_submit_per_session} submits used this session`), period: 'session' };
    }
  }
  for (const p of config.employer_policies ?? []) {
    if ((p.company ?? '').toLowerCase() !== company) continue;
    const used = sameCompany.filter((r) => r.ms > nowMs - p.period_days * DAY_MS).length;
    if (used >= p.max) return refuse(`employer policy allows ${p.max} per ${p.period_days} days at ${p.company}`);
  }
  if (args.track && sameCompany.length) {
    const existing = [...new Set(sameCompany.map((r) => detailValue(r.detail, 'track')).filter(Boolean))];
    const confirmed = rows.some((r) => r.action === 'apply.track-confirm' && (r.company ?? '').toLowerCase() === company && detailValue(r.detail, 'track') === args.track);
    if (existing.length && !existing.includes(args.track) && !confirmed) {
      return { status: 'needs-user', reason: `${args.company} already has track ${existing.join(', ')}; confirm ${args.track} with the user`, remaining: null, earliest: null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// CLI

// --batch is the integer fill-session size; --batch-id names an approval batch and --item its numbered line.
// --email is the address of a gmail.send whose --target is the contact's name; --nudge marks that email as the contact's
// follow-up; --followup marks it as an application's follow-up, with the application as --target.
const FLAGS = { reply: 'string', target: 'string', company: 'string', approval: 'string', track: 'string', length: 'int', batch: 'int', score: 'string', search: 'string', pending: 'int', tier: 'string', 'batch-id': 'string', item: 'int', items: 'string', email: 'string', nudge: 'boolean', followup: 'boolean' };
const COMMANDS = ['check', 'log', 'session-start', 'status', 'warning', 'due-withdrawals'];
// Outreach sends name the person and the company, so the hygiene rules never run on half a key. An application
// follow-up email (gmail.send --followup) names the application and needs no company.
const NEEDS_PERSON = [...LINKEDIN_SENDS, 'gmail.send', 'gmail.pending'];

function sessionFile(dataDir) {
  return join(dataDir, '.student-session.json');
}
function readSession(dataDir) {
  const file = sessionFile(dataDir);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function loadConfig(paths) {
  const defaults = readFileSync(join(paths.packRoot, 'templates', 'student.defaults.yml'), 'utf8');
  const file = join(paths.configDir, 'student.yml');
  const config = { ...parseConfig(existsSync(file) ? readFileSync(file, 'utf8') : '', defaults) };
  try {
    config.employer_policies = loadMerged(config.presets ?? [], { root: paths.root, dataDir: paths.dataDir })?.employer_policies ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    config.employer_policies = [];
  }
  return config;
}

function argsFrom(flags, recheck = false) {
  let score;
  if (flags.score !== undefined) {
    score = Number(flags.score);
    if (!Number.isFinite(score)) throw new UsageError(`--score expects a number, got "${flags.score}"`);
  }
  return { target: flags.target, company: flags.company, track: flags.track, length: flags.length, batch: flags.batch, score, search: flags.search, pending: flags.pending, tier: flags.tier, batchId: flags.batchId, item: flags.item, email: flags.email, nudge: Boolean(flags.nudge), followup: Boolean(flags.followup), recheck };
}

async function logClamps(file, config, clock, session, history) {
  const { clamps } = effectiveLimits(config);
  const fresh = clamps.filter((c) => !history.some((r) => r.action === 'budget.clamp' && r.target === c.key && (detailValue(r.detail, c.key) === String(c.configured))));
  const ts = clock.now();
  const out = fresh.map((c) => ({ ts: ts.toISOString(), date: clock.today(), session, action: 'budget.clamp', target: c.key, company: '', approval: '', detail: `${c.key}=${c.configured};ceiling=${c.ceiling}` }));
  await appendAction(file, out);
  return out;
}

function describe(res, clock) {
  if (res.status === 'wait') {
    const t = new Date(res.earliest);
    const p = clock.localTime(t);
    const secs = String(t.getUTCSeconds()).padStart(2, '0');
    return `wait: earliest allowed ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${secs} local (${res.earliest})`;
  }
  return `${res.status}: ${res.reason}${res.status === 'ok' && res.remaining !== null ? ` (${res.remaining} left)` : ''}`;
}

async function cmdWarning({ positionals, write, mkRow }) {
  const which = positionals[0];
  if (!['linkedin', 'handshake'].includes(which)) throw new UsageError('warning expects linkedin or handshake');
  await write([mkRow(`${which}.warning`)]);
  console.log(`warning logged: no ${which} actions until the next local day`);
  return 0;
}

async function cmdDueWithdrawals({ clock, history, flags }) {
  const cutoff = clock.now().getTime() - CEILINGS.invite_withdraw_days.value * DAY_MS;
  const closed = new Set(history.filter((r) => r.action === 'linkedin.accept' || r.action === 'linkedin.withdraw').map((r) => r.target));
  const due = history.filter((r) => r.action === 'linkedin.connect' && r.ms < cutoff && !closed.has(r.target));
  if (flags.json) console.log(JSON.stringify(due.map((r) => ({ target: r.target, company: r.company, ts: r.ts }))));
  else if (!due.length) console.log('no withdrawals due');
  else for (const r of due) console.log(`${r.target}\t${r.company}\t${r.date}`);
  return 0;
}

async function cmdSessionStart({ paths, file, config, clock, sess, history, flags }) {
  const id = randomUUID().slice(0, 8);
  const previous = sess?.started ? Date.parse(sess.started) : undefined;
  if (!flags.dryRun) await logClamps(file, config, clock, id, history);
  const rows = await readActionLog(file);
  const clampRows = rows.filter((r) => r.action === 'budget.clamp' && (previous === undefined || r.ms >= previous));
  const stops = rows.filter((r) => r.date === clock.today() && (r.action.endsWith('.warning') || r.action === 'budget.refusal'));
  if (!flags.dryRun) {
    mkdirSync(paths.dataDir, { recursive: true });
    writeFileSync(sessionFile(paths.dataDir), `${JSON.stringify({ id, started: clock.now().toISOString() })}\n`);
  }
  console.log(`session ${id}`);
  for (const r of clampRows) console.log(`clamp: ${r.detail.replace(';', ' (')})`);
  for (const r of stops) console.log(`stop: ${r.action === 'budget.refusal' ? `${r.target} refused today` : `${r.action} logged today`}`);
  return 0;
}

async function cmdStatus({ clock, history, session, flags }) {
  const today = clock.today();
  const week = clock.now().getTime() - 7 * DAY_MS;
  const n = (pred) => history.filter(pred).length;
  const st = {
    session,
    connects_today: n((r) => r.action === 'linkedin.connect' && r.date === today),
    connects_rolling_7d: n((r) => r.action === 'linkedin.connect' && r.ms > week),
    messages_today: n((r) => r.action === 'linkedin.message' && r.date === today),
    profile_views_today: n((r) => r.action === 'linkedin.profile_view' && r.date === today),
    submits_today: n((r) => (r.action === 'apply.submit' || r.action === 'apply.easy_apply') && r.date === today),
    warnings_today: history.filter((r) => r.date === today && r.action.endsWith('.warning')).map((r) => r.action),
    refusals_today: history.filter((r) => r.date === today && r.action === 'budget.refusal').map((r) => r.target),
  };
  if (flags.json) console.log(JSON.stringify(st));
  else for (const [k, v] of Object.entries(st)) console.log(`${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`);
  return 0;
}

function actionFrom({ command, positionals, flags }) {
  const action = positionals[0];
  if (!action || (!CHECKABLE.includes(action) && !(command === 'log' && OBSERVED.includes(action)))) {
    throw new UsageError(`unknown action ${action ?? '(none)'}`);
  }
  if (positionals.length > 1) throw new UsageError('too many arguments');
  if (command === 'log' && NEEDS_APPROVAL.includes(action) && !APPROVAL_RE.test(flags.approval ?? '')) {
    throw new UsageError(`${action} needs --approval like "send all" or "submit 1,2"`);
  }
  if (command === 'log' && SEND_KINDS.includes(action) && (!flags.batchId || !Number.isInteger(flags.item))) {
    throw new UsageError(`${action} needs --batch-id and --item of the approved batch item`);
  }
  if (NEEDS_PERSON.includes(action) && !(action.startsWith('gmail.') && flags.followup)) {
    if (!String(flags.target ?? '').trim() || !String(flags.company ?? '').trim()) throw new UsageError(`${action} needs --target with the contact's name and --company`);
  }
  return action;
}

async function logAllowed({ action, now, env, res }) {
  const { flags, config, write, mkRow, rng } = env;
  const details = [];
  if (groupOf(action) === 'linkedin') {
    if (flags.length > 0 && action === 'linkedin.connect') details.push(`note=${flags.length}`);
    details.push(`next_allowed=${new Date(now.getTime() + drawGapMs(config, rng)).toISOString()}`);
  }
  if (flags.track) details.push(`track=${flags.track}`);
  if (flags.batchId) details.push(`batch=${flags.batchId}`);
  if (Number.isInteger(flags.item)) details.push(`item=${flags.item}`);
  if (flags.email) details.push(`email=${flags.email}`);
  if (flags.nudge) details.push('nudge=1');
  if (flags.followup) details.push('followup=1');
  const searchId = flags.search ?? flags.target ?? '';
  if (action === 'handshake.page') details.push(`search=${searchId}`);
  await write([
    mkRow(action, {
      target: action === 'handshake.page' || action === 'linkedin.search_page' ? searchId : flags.target ?? '',
      company: flags.company ?? '',
      approval: flags.approval ?? '',
      detail: details.join(';'),
    }),
  ]);
  console.log(flags.json ? JSON.stringify(res) : `logged ${action}`);
  return 0;
}

async function cmdCheckLog(env) {
  const { command, flags, paths, file, config, clock, session, history, write, mkRow } = env;
  const action = actionFrom(env);
  const fresh = flags.dryRun ? [] : await logClamps(file, config, clock, session, history);
  const all = [...history, ...fresh.map((r) => ({ ...r, ms: Date.parse(r.ts) }))];
  const now = clock.now();

  if (command === 'log' && action === 'batch.approve') return logBatchApprove(env);
  if (command === 'log' && action === 'apply.pending') return logPending(env);
  if (command === 'log' && action === 'gmail.pending') return logGmailPending(env);
  if (command === 'log' && action === 'linkedin.fresh_search') return logFreshSearch(env);
  if (command === 'log' && OBSERVED.includes(action)) {
    // A reply logged with --reply (its message id or text hash) is logged once per contact, so reading it again adds nothing.
    const replyKey = action === 'linkedin.reply' && flags.reply ? String(flags.reply).replace(/[;=\s]/g, '') : '';
    const same = (r) => r.action === action && lower(r.target) === lower(flags.target) && lower(r.company) === lower(flags.company) && detailValue(r.detail, 'reply') === replyKey;
    if (replyKey && history.some(same)) {
      console.log(`${action} already logged for this reply`);
      return 0;
    }
    const detail = [flags.track && `track=${flags.track}`, flags.batchId && `batch=${flags.batchId}`, Number.isInteger(flags.item) && `item=${flags.item}`, replyKey && `reply=${replyKey}`].filter(Boolean).join(';');
    await write([mkRow(action, { target: flags.target ?? '', company: flags.company ?? '', detail })]);
    console.log(`logged ${action}`);
    return 0;
  }

  const { rows: contacts } = await readTsv(join(paths.dataDir, 'contacts.tsv'));
  const batch = command === 'check' && SEND_KINDS.includes(action) && flags.batchId ? readBatch(paths.dataDir, flags.batchId) : null;
  const res = evaluateCheck({ action, args: argsFrom(flags, command === 'log'), history: all, contacts, config, session, now, batch });
  if (res.status === 'refused' && !res.repeat && !res.unlogged) {
    const scope = res.scope ?? action;
    await write([mkRow('budget.refusal', { target: scope, detail: `period=${res.period ?? 'day'};reason=${res.reason}` })]);
  }
  if (command === 'check' || res.status !== 'ok') {
    console.log(flags.json ? JSON.stringify(res) : describe(res, clock));
    return EXIT[res.status];
  }
  return logAllowed({ action, now, env, res });
}

// A pending row is a compare-and-set under the action-log lock, logged right before a click: the fresh rows must still
// hold an approved, unused item and the action's own check (check(rows) returns a refusal result or null) must still
// pass, so the item is spent before the click and two clicks of one item (a retry after a timeout, a scheduled run beside
// a session) never both happen.
async function logPendingRow({ flags, file, mkRow, clock }, action, check, detail) {
  if (!flags.batchId || !Number.isInteger(flags.item)) throw new UsageError(`${action} needs --batch-id and --item of the approved batch item`);
  if (flags.dryRun) {
    console.log(`logged ${action} (dry run)`);
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, async () => {
    const rows = await readActionLog(file);
    if (!approvedItem(rows, flags.batchId, flags.item)) {
      console.log(`refused: item ${flags.item} of batch ${flags.batchId} has no unused logged approval`);
      return EXIT.refused;
    }
    const stop = await check(rows);
    if (stop) {
      console.log(describe(stop, clock));
      return EXIT[stop.status];
    }
    const row = mkRow(action, { target: flags.target ?? '', company: flags.company ?? '', detail: detail.filter(Boolean).join(';') });
    if (!existsSync(file) || statSync(file).size === 0) writeFileSync(file, `${LOG_HEADER.join('\t')}\n`);
    appendFileSync(file, `${LOG_HEADER.map((h) => escapeCell(row[h])).join('\t')}\n`);
    console.log(`logged ${action}`);
    return 0;
  });
}

// apply.pending: the daily submit ceiling must still allow one more, so two submits of different items never both pass
// the last daily slot.
function logPending(env) {
  const { flags, config, session, clock } = env;
  const check = (rows) => {
    const ctx = makeContext({ action: 'apply.submit', args: argsFrom(flags, true), history: rows, config, session, now: clock.now() });
    return ctx.cap(ctx.L.submit_per_day, submitRows(rows, ctx.args).filter(ctx.isToday).length, 'submits today');
  };
  return logPendingRow(env, 'apply.pending', check, [flags.track && `track=${flags.track}`, `batch=${flags.batchId}`, `item=${flags.item}`]);
}

// gmail.pending, logged by lib/gmail-chrome.mjs before the Send click: gmail.send must still pass.
function logGmailPending(env) {
  const { flags, paths, config, session, clock } = env;
  const check = async (rows) => {
    const { rows: contacts } = await readTsv(join(paths.dataDir, 'contacts.tsv'));
    const res = evaluate({ action: 'gmail.send', args: argsFrom(flags, true), history: rows, contacts, config, session, now: clock.now() });
    return res.status === 'ok' ? null : res;
  };
  return logPendingRow(env, 'gmail.pending', check, [`batch=${flags.batchId}`, `item=${flags.item}`, flags.email && `email=${flags.email}`, flags.nudge && 'nudge=1', flags.followup && 'followup=1']);
}

// linkedin.fresh_search is logged before the page read, as a compare-and-set under the action-log lock: the fresh rows
// must still allow one more read this hour, so a read that fails or times out still counts and a session read beside the
// hourly one never both pass.
async function logFreshSearch({ flags, file, mkRow, config, session, clock, rng }) {
  if (flags.dryRun) {
    console.log('logged linkedin.fresh_search (dry run)');
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, async () => {
    const rows = await readActionLog(file);
    const now = clock.now();
    const res = evaluateCheck({ action: 'linkedin.fresh_search', args: argsFrom(flags, true), history: rows, config, session, now });
    if (res.status !== 'ok') {
      console.log(flags.json ? JSON.stringify(res) : describe(res, clock));
      return EXIT[res.status];
    }
    const row = mkRow('linkedin.fresh_search', { target: flags.target ?? '', detail: `next_allowed=${new Date(now.getTime() + drawGapMs(config, rng)).toISOString()}` });
    if (!existsSync(file) || statSync(file).size === 0) writeFileSync(file, `${LOG_HEADER.join('\t')}\n`);
    appendFileSync(file, `${LOG_HEADER.map((h) => escapeCell(row[h])).join('\t')}\n`);
    console.log(flags.json ? JSON.stringify(res) : 'logged linkedin.fresh_search');
    return 0;
  });
}

// The student's approval of one batch: the batch id, the approved item numbers and their own words.
async function logBatchApprove({ flags, config, write, mkRow }) {
  const items = listOf(flags.items);
  if (!flags.batchId || !items.length || !String(flags.approval ?? '').trim()) {
    throw new UsageError('batch.approve needs --batch-id, --items like "1,2,4" and --approval with the student\'s words');
  }
  const { values } = effectiveLimits(config);
  if (items.length > values.approval_batch_max) {
    console.log(`refused: ${items.length} items exceed approval_batch_max of ${values.approval_batch_max}`);
    return EXIT.refused;
  }
  const detail = `batch=${flags.batchId};items=${items.join(',')}`;
  await write([mkRow('batch.approve', { approval: flags.approval, detail })]);
  console.log(`logged batch.approve ${flags.batchId}: items ${items.join(',')}`);
  return 0;
}

const COMMAND_HANDLERS = { warning: cmdWarning, 'due-withdrawals': cmdDueWithdrawals, 'session-start': cmdSessionStart, status: cmdStatus };

export async function main({ rng = Math.random } = {}) {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { commands: COMMANDS, flags: FLAGS });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const file = join(paths.dataDir, 'action-log.tsv');
  let config;
  try {
    config = loadConfig(paths);
  } catch (err) {
    if (err instanceof ConfigError) throw new UsageError(err.message);
    throw err;
  }
  const clock = createClock({ today: flags.today, timezone: config.timezone });
  const sess = readSession(paths.dataDir);
  const session = sess?.id ?? 'no-session';
  const history = await readActionLog(file);
  const mkRow = (action, o = {}) => ({ ts: clock.now().toISOString(), date: clock.today(), session, action, target: '', company: '', approval: '', detail: '', ...o });
  const write = (rows) => (flags.dryRun ? Promise.resolve() : appendAction(file, rows));
  const env = { command, positionals, flags, paths, file, config, clock, sess, session, history, mkRow, write, rng };
  return (COMMAND_HANDLERS[command] ?? cmdCheckLog)(env);
}

if (isMain(import.meta.url)) await runCli(main);
