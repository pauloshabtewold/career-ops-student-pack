#!/usr/bin/env node
// Hard budget ceilings for LinkedIn, Handshake, applications, unattended runs and discovery.
// CEILINGS is frozen and nothing reads the environment: config limits can only tighten a ceiling, and every
// clamp of a looser value is logged. compat.json carries this file's SHA-256 (scripts/compat-hash.mjs).
// Model-usage triage is not a ceiling here: the student owns that budget (lib/triage-budget.mjs).
// Exit codes: 0 ok, 2 usage, 3 refused, 4 wait, 5 needs the user.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs, runCli, UsageError, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { parseConfig, ConfigError, deepFreeze } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { appendAction, readActionLog, detailValue } from '../lib/action-log.mjs';

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
  nudge_per_target: down(1, 'count', 'target'),
  nudge_min_days: up(5, 'days', 'target'),
  notes_free_per_rolling_7d: down(2, 'count', 'rolling-7d'),
  note_len_free: down(200, 'chars', 'note'),
  note_len_premium: down(300, 'chars', 'note'),
  opener_len: down(299, 'chars', 'message'),
  invite_withdraw_days: down(21, 'days', 'invite'),
  rounds_per_day: down(1, 'count', 'day'),
  // Applications
  submit_per_day: down(10, 'count', 'day'),
  first_week_submit_per_session: down(3, 'count', 'session'),
  first_week_days: down(7, 'days', 'once'),
  batch_size: down(3, 'count', 'batch'),
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
  'handshake.page',
  'apply.submit',
  'apply.jd_browser',
];
// Events recorded as they happen; they are not budgeted and carry no gap.
const OBSERVED = ['linkedin.accept', 'apply.track-confirm', 'apply.policy'];
const APPROVAL_RE = /^(send|submit) (all|\d+(,\s*\d+)*)$/;
const NEEDS_APPROVAL = [...LINKEDIN_SENDS, 'apply.submit'];
const EXIT = { ok: 0, refused: 3, wait: 4, 'needs-user': 5 };

const groupOf = (action) => (action.startsWith('linkedin.') ? 'linkedin' : action.startsWith('handshake.') ? 'handshake' : null);
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

function makeContext({ action, args, history, config, session, now }) {
  const { values: L } = effectiveLimits(config);
  const local = createClock({ timezone: config.timezone }).localTime(now);
  const nowMs = now.getTime();
  const rows = history.map((r) => ({ ...r, ms: r.ms ?? Date.parse(r.ts) }));
  const remainingFrom = [];
  const refuse = (reason, extra = {}) => result('refused', reason, { period: 'day', ...extra });
  const cap = (limit, used, what) => {
    if (used >= limit) return refuse(`${what}: ${used} of ${limit} used`);
    remainingFrom.push(limit - used - 1);
    return null;
  };
  return {
    action, args, config, session, L, local, nowMs, rows, remainingFrom, refuse, cap,
    group: groupOf(action),
    count: (pred) => rows.filter(pred).length,
    isToday: (r) => r.date === local.date,
    inWeek: (r) => r.ms > nowMs - 7 * DAY_MS && r.ms <= nowMs,
  };
}

function switchRefusal({ group, config, action, refuse }) {
  const switches = config.switches ?? {};
  if (group === 'handshake' && switches.handshake === 'off') return refuse('handshake is switched off', { period: 'day' });
  if (LINKEDIN_SENDS.includes(action) && switches.outreach !== undefined && switches.outreach !== 'on') {
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

function windowRefusal({ group, local, refuse }) {
  if (group !== 'linkedin') return null;
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
    companyCap(rows, args, L.contacts_per_company, cap);
  return stop || noteRule(ctx, connects);
}

function messageRule({ args, L, rows, count, isToday, refuse, cap }) {
  const stop = cap(L.message_per_day, count((r) => r.action === 'linkedin.message' && isToday(r)), 'messages today') || companyCap(rows, args, L.contacts_per_company, cap);
  if (stop) return stop;
  const first = !rows.some((r) => r.action === 'linkedin.message' && r.target === args.target);
  return first && args.length > L.opener_len ? refuse(`first message of ${args.length} characters exceeds ${L.opener_len}`) : null;
}

function nudgeRule({ args, L, rows, nowMs, refuse, cap }) {
  const mine = rows.filter((r) => r.target === args.target);
  const stop = cap(L.nudge_per_target, mine.filter((r) => r.action === 'linkedin.nudge').length, 'nudges to this target') || companyCap(rows, args, L.contacts_per_company, cap);
  if (stop) return stop;
  const lastMsg = Math.max(-Infinity, ...mine.filter((r) => r.action === 'linkedin.message').map((r) => r.ms));
  return nowMs - lastMsg < L.nudge_min_days * DAY_MS ? refuse(`last message to this target is under ${L.nudge_min_days} days old`) : null;
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

const ACTION_RULES = {
  'linkedin.connect': connectRule,
  'linkedin.message': messageRule,
  'linkedin.nudge': nudgeRule,
  'linkedin.profile_view': (c) => c.cap(c.L.profile_view_per_day, c.count((r) => r.action === c.action && c.isToday(r)), 'profile views today'),
  'linkedin.search_page': (c) => sessionCap(c, c.L.search_page_per_session, c.count((r) => r.action === c.action && r.session === c.session), 'search pages this session'),
  'handshake.page': handshakePageRule,
  'apply.jd_browser': (c) => sessionCap(c, c.L.jd_browser_per_session, c.count((r) => r.action === c.action && r.session === c.session), 'browser job descriptions this session'),
  'apply.submit': submitRules,
};

function gapOrOk({ group, rows, nowMs, remainingFrom }) {
  if (group === 'linkedin') {
    const next = Math.max(-Infinity, ...rows.filter((r) => r.action.startsWith('linkedin.')).map((r) => Date.parse(detailValue(r.detail, 'next_allowed') ?? '')).filter(Number.isFinite));
    if (next > nowMs) return result('wait', `LinkedIn gap not elapsed; earliest ${new Date(next).toISOString()}`, { earliest: new Date(next).toISOString() });
  }
  return result('ok', 'within budget', { remaining: remainingFrom.length ? Math.min(...remainingFrom) : null });
}

/** Decides one action. history is the action-log rows; gaps are drawn at log time, not here. */
export function evaluate({ action, args = {}, history = [], config = {}, session = '', now = createClock({ timezone: config.timezone }).now() }) {
  const ctx = makeContext({ action, args, history, config, session, now });
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

function submitRules({ rows, args, config, L, session, nowMs, isToday, cap, refuse }) {
  const submits = rows.filter((r) => r.action === 'apply.submit');
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

const FLAGS = { target: 'string', company: 'string', approval: 'string', track: 'string', length: 'int', batch: 'int', score: 'string', search: 'string', pending: 'int', tier: 'string' };
const COMMANDS = ['check', 'log', 'session-start', 'status', 'warning', 'due-withdrawals'];

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
  return { target: flags.target, company: flags.company, track: flags.track, length: flags.length, batch: flags.batch, score, search: flags.search, pending: flags.pending, tier: flags.tier, recheck };
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
    submits_today: n((r) => r.action === 'apply.submit' && r.date === today),
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
  const { command, flags, file, config, clock, session, history, write, mkRow } = env;
  const action = actionFrom(env);
  const fresh = flags.dryRun ? [] : await logClamps(file, config, clock, session, history);
  const all = [...history, ...fresh.map((r) => ({ ...r, ms: Date.parse(r.ts) }))];
  const now = clock.now();

  if (command === 'log' && OBSERVED.includes(action)) {
    await write([mkRow(action, { target: flags.target ?? '', company: flags.company ?? '', detail: flags.track ? `track=${flags.track}` : '' })]);
    console.log(`logged ${action}`);
    return 0;
  }

  const res = evaluate({ action, args: argsFrom(flags, command === 'log'), history: all, config, session, now });
  if (res.status === 'refused' && !res.repeat) {
    const scope = res.scope ?? action;
    await write([mkRow('budget.refusal', { target: scope, detail: `period=${res.period ?? 'day'};reason=${res.reason}` })]);
  }
  if (command === 'check' || res.status !== 'ok') {
    console.log(flags.json ? JSON.stringify(res) : describe(res, clock));
    return EXIT[res.status];
  }
  return logAllowed({ action, now, env, res });
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
