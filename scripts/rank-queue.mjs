#!/usr/bin/env node
// Ranked daily apply list. Read-only: it never writes a file.
// Pending rows at or above the effective score floor are scored by the weights in config.rank.weights
// (triage fit, posting age, marquee employer, metro match, warm contact, referral state), then at most
// per_company_per_day rows per company are listed, after folding parent companies together.
// Optional rank config: company_caps, intern_only, one_track_per_company and ignore_words narrow the list; weights.effort,
// easy_apply_hosts, contacts_format, metro_match and hold_on_pending_connect tune scoring and contact parsing (docs/usage.md).
// Pending rows may carry a hold=YYYY-MM-DD note (held until that date; free text after the date is allowed) or a reserved-slot
// note (free text after the key is allowed; the company's other Pending rows are blocked, not held).
// Usage: rank-queue.mjs [--n N] [--json] [--root R] [--data-dir D] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { ISO_DATE, createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { parseTsv } from '../lib/tsv.mjs';
import { CEILINGS, effectiveLimits } from './budget.mjs';

// Used only when config.rank.weights is empty; a configured map replaces it, so unlisted factors weigh nothing.
// effort defaults to 0 so default scores ignore it; a student opts in through rank.weights.
export const DEFAULT_WEIGHTS = Object.freeze({ triage: 10, age: 4, marquee: 2, metro: 1, warm: 2, referral: 5, effort: 0 });
const DAY_MS = 86400000;
const GENERIC = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'the', 'group', 'technologies', 'technology', 'labs', 'lab', 'software', 'systems', 'holdings']);
// A hold value is a leading date, then end of value or whitespace and free text; '2026-11-05x' is not a date.
const HOLD_DATE = /^(\d{4}-\d{2}-\d{2})(?:\s|$)/;
// The bare key or the key followed by free text; a longer key such as reserved-slots is a different note.
const RESERVED_SLOT = /^reserved-slot(?:$|[\s(])/;
// Used only when config.rank.easy_apply_hosts is unset; these ATS hosts count as quick to apply to, which the effort factor rewards.
const DEFAULT_EASY_HOSTS = ['greenhouse', 'ashby', 'lever'];
// Statuses that mean an application was made. Rejected is left out: a rejected row stops counting toward track history,
// and its slot against company_caps survives only through the logged submit in submitCounts.
const APPLIED_STATUS = new Set(['applied', 'responded', 'assessment', 'interview', 'offer', 'hired']);
const tokens = (s, ignore = []) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !GENERIC.has(t) && !ignore.includes(t));
const rawKey = (s, ignore) => tokens(s, ignore).sort().join(' ');
// co-?op covers both spellings; \b keeps 'internal' from reading as an internship.
const isIntern = (title) => /\b(intern|internship|co-?op)\b/i.test(title ?? '');

// parent_companies: { parent: [alias, ...] } so a subsidiary counts against its parent's cap.
// ignore: extra lowercase tokens dropped from every key, on top of GENERIC (rank.ignore_words).
export function companyKey(name, parents = {}, ignore = []) {
  const key = rawKey(name, ignore);
  for (const [parent, aliases] of Object.entries(parents)) {
    const all = [parent, ...(Array.isArray(aliases) ? aliases : [])].map((a) => rawKey(a, ignore));
    if (all.some((a) => a && (key === a || key.split(' ').includes(a)))) return rawKey(parent, ignore);
  }
  return key;
}

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

const newer = (a, b) => (!a || b > a ? b : a);
const freshState = () => ({ referred: false, warm: false, connectOn: null, askedOn: null });
// Notes that withdraw a pending connection request: the contact accepted, or the student marked the contact off limits.
const INVITE_CANCEL = /status:accepted|do-not-contact|do-not-ask|skipped/i;

// contacts.tsv columns: date, company, name, stage (connect | accepted | referral-ask | referred).
function stageState(text, keyOf) {
  const state = new Map();
  for (const r of parseTsv(text).rows) {
    const key = keyOf(r.company);
    if (!key) continue;
    const s = state.get(key) ?? freshState();
    if (r.stage === 'referred') s.referred = true;
    if (r.stage === 'accepted') s.warm = true;
    if (r.stage === 'connect') s.connectOn = newer(s.connectOn, r.date);
    if (r.stage === 'referral-ask') s.askedOn = newer(s.askedOn, r.date);
    state.set(key, s);
  }
  return state;
}

// MM-DD in today's year, or in the previous year when that date is still ahead of today (a note is written about the past).
// null for a month and day that do not exist, such as 13-45 or 02-30.
function resolveMonthDay(mmdd, today) {
  const [m, d] = mmdd.split('-').map(Number);
  const build = (y) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  const year = Number(today.slice(0, 4));
  const here = build(year);
  return here !== null && here > today ? build(year - 1) : here;
}

// A tab-separated file with company and notes columns, the header optionally starting with '# '. State comes from status: tokens in the notes:
// referred; warm or accepted; asked MM-DD (referral ask date); sent MM-DD (connect = date of a pending connection request; the literal token ends with '(connect').
// missing names the header columns that are absent; with any missing the state is empty and the caller reports it.
function statusNotesState(text, keyOf, today) {
  const state = new Map();
  const lines = text.split(/\r?\n/).filter((l) => l !== '');
  if (!lines.length) return { state, missing: [] };
  const header = lines[0].replace(/^#\s*/, '').split('\t').map((h) => h.trim().toLowerCase());
  const at = { company: header.indexOf('company'), notes: header.indexOf('notes') };
  const missing = ['company', 'notes'].filter((name) => at[name] === -1);
  if (missing.length) return { state, missing };
  for (const l of lines.slice(1)) {
    const cells = l.split('\t');
    const key = keyOf(cells[at.company] ?? '');
    if (!key) continue;
    const notes = cells[at.notes] ?? '';
    const s = state.get(key) ?? freshState();
    if (/status:referred/i.test(notes)) s.referred = true;
    if (/status:(?:warm|accepted)/i.test(notes)) s.warm = true;
    for (const m of notes.matchAll(/status:asked\s+(\d{2}-\d{2})/gi)) {
      const on = resolveMonthDay(m[1], today);
      if (on) s.askedOn = newer(s.askedOn, on);
    }
    if (!INVITE_CANCEL.test(notes)) {
      for (const m of notes.matchAll(/status:sent\s+(\d{2}-\d{2})\s*\(connect/gi)) {
        const on = resolveMonthDay(m[1], today);
        if (on) s.connectOn = newer(s.connectOn, on);
      }
    }
    state.set(key, s);
  }
  return { state, missing: [] };
}

// Returns { state, missing }; missing is non-empty only for status-notes contacts whose header lacks a required column.
function contactState(text, keyOf, { format = 'stage', today } = {}) {
  return format === 'status-notes' ? statusNotesState(text, keyOf, today) : { state: stageState(text, keyOf), missing: [] };
}

// Posting age in days from a posted~<N>d token, else from a posted=<date> or imported=<date> token.
function postingAge(notes, today) {
  for (const k of notes.keys()) {
    const m = /^posted~(\d+)d$/.exec(k);
    if (m) return Number(m[1]);
  }
  const date = notes.get('posted') ?? notes.get('imported');
  return ISO_DATE.test(date ?? '') ? daysBetween(date, today) : null;
}

function connectionCounts(csvText, keyOf) {
  const counts = new Map();
  const lines = csvText.split(/\r?\n/);
  const header = lines.findIndex((l) => /^First Name,/i.test(l));
  if (header === -1) return counts;
  const cols = lines[header].split(',');
  const at = cols.indexOf('Company');
  for (const l of lines.slice(header + 1)) {
    const company = l.split(',')[at];
    if (!company) continue;
    const key = keyOf(company);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Logged apply.submit rows per company key; a date limits the count to that day, otherwise it is all-time.
function submitCounts(actionRows, keyOf, date) {
  const counts = new Map();
  for (const r of actionRows) {
    if (r.action === 'apply.submit' && (date === undefined || r.date === date) && !/refus|dry/i.test(r.detail ?? '')) {
      const key = keyOf(r.company);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// applications.md rows at an applied-or-later status, per company key: { n, intern, fulltime }.
// Track comes from the role cell here; isBlocked reads the Pending row's title with the same isIntern test, so both
// sides classify a role the same way.
// Columns: | # | date | company | role | score | status | ...; splitting on '|' puts the # cell at index 1.
function appliedHistory(text, keyOf) {
  const history = new Map();
  for (const l of text.split(/\r?\n/)) {
    const cells = l.split('|').map((c) => c.trim());
    if (!/^\d+$/.test(cells[1] ?? '') || !APPLIED_STATUS.has((cells[6] ?? '').replace(/\*/g, '').toLowerCase())) continue;
    const key = keyOf(cells[3]);
    const h = history.get(key) ?? { n: 0, intern: false, fulltime: false };
    h.n++;
    if (isIntern(cells[4])) h.intern = true;
    else h.fulltime = true;
    history.set(key, h);
  }
  return history;
}

// Application effort: a prebuilt application is cheapest, a posting on an easy-apply host next, any other form the most work.
// Substring of the host, not an exact label: 'ashby' has to match jobs.ashbyhq.com. Broad entries such as 'lever' also hit 'clever.com'; see docs/usage.md.
function effortFactor(row, easyHosts) {
  if (String(row.notes.get('prebuilt') ?? '').toLowerCase() === 'yes') return 1;
  let host;
  try {
    host = new URL(row.url).hostname.toLowerCase();
  } catch {
    return 0.5;
  }
  return easyHosts.some((h) => host.includes(h)) ? 0.8 : 0.5;
}

// One test per metro. word mode anchors at word boundaries so the metro LA does not match Atlanta; the metro is escaped
// so a dot or bracket in it is literal. substring mode matches anywhere in the location.
function metroTests(metros, mode) {
  return metros.map((m) => {
    if (mode === 'substring') {
      const needle = m.toLowerCase();
      return (location) => location.toLowerCase().includes(needle);
    }
    const re = new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return (location) => re.test(location);
  });
}

// A blocked row is counted apart from a held one because holds lift on their own.
function isBlocked(row, key, rules) {
  const { reservedFor, internOnly, oneTrack, history, caps, appliedCount } = rules;
  if (reservedFor.has(key) && reservedFor.get(key) !== row.url) return true;
  const intern = isIntern(row.title);
  if (internOnly.has(key) && !intern) return true;
  const past = history.get(key);
  if (oneTrack && past && (intern ? past.fulltime : past.intern)) return true;
  return caps.has(key) && appliedCount(key) >= caps.get(key);
}

// false for setups that only lower the score of a row with a pending invite; the referral-ask wait stays because those setups still honor it.
function isHeld(state, age, today, holdOnConnect = true) {
  // A referral ask gets three days to be answered before the same company is applied to cold.
  if (state.askedOn && !state.referred && daysBetween(state.askedOn, today) < 3) return true;
  // A fresh connection request may still become a referral, so the row waits unless the posting is already old.
  return holdOnConnect && Boolean(state.connectOn && !state.warm && !state.referred && daysBetween(state.connectOn, today) < 5 && !(age !== null && age > 14));
}

function scoreRow({ row, triage, key, age, state }, { weights, marquee, metroTests, connections, appliedBefore, easyHosts }) {
  const why = [];
  const fresh = age === null ? 0.4 : age <= 3 ? 1 : age <= 7 ? 0.8 : age <= 14 ? 0.55 : 0.3;
  const referral = state.referred ? 1 : 0;
  const warm = state.warm || connections.get(key) ? 1 : 0;
  if (state.referred) why.push('referral ready');
  if (warm) why.push('warm contact');
  if (age !== null && age <= 3) why.push('fresh');
  const inMetro = metroTests.some((test) => test(row.location)) ? 1 : 0;
  const score =
    weights.triage * triage + weights.age * fresh + weights.marquee * (marquee.has(key) ? 1 : 0) + weights.metro * inMetro + weights.warm * warm + weights.referral * referral + weights.effort * effortFactor(row, easyHosts);
  return { url: row.url, company: row.company, title: row.title, location: row.location, triage, score: Math.round(score * 10) / 10, why: why.join(', '), key, applied: appliedBefore.has(key) };
}

// remainder(key) is the room a company cap leaves (Infinity without one); company_caps can only lower the per-day limit, never raise it.
function pickTop(scored, appliedToday, perDay, n, remainder = () => Infinity) {
  const perCompany = new Map(appliedToday);
  const picked = new Map();
  const picks = [];
  for (const r of scored) {
    const mine = picked.get(r.key) ?? 0;
    if ((perCompany.get(r.key) ?? 0) >= perDay || mine >= remainder(r.key)) continue;
    picked.set(r.key, mine + 1);
    perCompany.set(r.key, (perCompany.get(r.key) ?? 0) + 1);
    picks.push(r);
    if (picks.length >= n) break;
  }
  return picks;
}

// Cap, track and reserved-slot inputs. The cap count is the larger of the tracker rows and the logged submits, so a
// tracker row later marked Rejected still uses its slot while its logged submit exists.
function blockRules({ config, pending, keyOf, history, submitted }) {
  const caps = new Map();
  // Two cap names that fold to one key keep the smaller cap: a student listing two spellings of one company gets the stricter limit.
  for (const [name, cap] of Object.entries(config.rank?.company_caps ?? {})) {
    const key = keyOf(name);
    caps.set(key, Math.min(caps.get(key) ?? Infinity, cap));
  }
  // First reserved-slot row in Pending file order wins; a later one for the same company is blocked like any other row.
  const reservedFor = new Map();
  for (const { row } of pending) {
    const key = keyOf(row.company);
    if (!reservedFor.has(key) && [...row.notes.keys()].some((k) => RESERVED_SLOT.test(k))) reservedFor.set(key, row.url);
  }
  const appliedCount = (key) => Math.max(history.get(key)?.n ?? 0, submitted.get(key) ?? 0);
  return {
    caps,
    reservedFor,
    history,
    appliedCount,
    internOnly: new Set((config.rank?.intern_only ?? []).map(keyOf)),
    oneTrack: config.rank?.one_track_per_company === true,
    remainder: (key) => (caps.has(key) ? caps.get(key) - appliedCount(key) : Infinity),
  };
}

export function rankQueue({ doc, config, today, actionRows = [], contactsText = '', connectionsText = '', applicationsText = '', n }) {
  const { values: limits } = effectiveLimits(config);
  const pending = sectionRows(doc, 'Pending');
  const floor = Math.max(CEILINGS.score_floor.value, limits.score_floor);
  const given = config.rank?.weights ?? {};
  const parents = config.rank?.parent_companies ?? {};
  const ignore = (config.rank?.ignore_words ?? []).map((w) => w.toLowerCase());
  const keyOf = (name) => companyKey(name, parents, ignore);
  const history = appliedHistory(applicationsText, keyOf);
  const scoring = {
    weights: Object.keys(given).length ? { triage: 0, age: 0, marquee: 0, metro: 0, warm: 0, referral: 0, effort: 0, ...given } : DEFAULT_WEIGHTS,
    easyHosts: (config.rank?.easy_apply_hosts ?? DEFAULT_EASY_HOSTS).map((h) => h.toLowerCase()),
    marquee: new Set((config.rank?.marquee ?? []).map(keyOf)),
    metroTests: metroTests(config.rank?.metros ?? [], config.rank?.metro_match ?? 'word'),
    connections: connectionCounts(connectionsText, keyOf),
    appliedBefore: new Set([...applicationsText.matchAll(/^\|\s*\d+\s*\|[^|]*\|\s*([^|]+?)\s*\|/gm)].map((m) => keyOf(m[1]))),
  };
  const { state: contacts, missing: contactsMissing } = contactState(contactsText, keyOf, { format: config.rank?.contacts_format, today });
  const holdOnConnect = config.rank?.hold_on_pending_connect !== false;
  const rules = blockRules({ config, pending, keyOf, history, submitted: submitCounts(actionRows, keyOf) });

  // Order: score floor, blocked, hold=DATE, contact-state hold, scoring. Blocked rows are permanent company rules
  // (reserved-slot, intern_only, one track, caps); a reserving row is itself evaluated normally. Blocked precedes holds
  // so a permanently blocked row is never reported as held and never looks like it will lift.
  const scored = [];
  let held = 0;
  let blocked = 0;
  for (const { row } of pending) {
    const triage = Number(row.notes.get('triage'));
    if (!Number.isFinite(triage) || triage < floor) continue;
    const key = keyOf(row.company);
    if (isBlocked(row, key, rules)) {
      blocked++;
      continue;
    }
    // hold=YYYY-MM-DD holds the row until that date passes; free text after the date is an annotation, any other shape is ignored. held also counts contact-state holds.
    const holdUntil = HOLD_DATE.exec(row.notes.get('hold') ?? '')?.[1];
    if (holdUntil && holdUntil > today) {
      held++;
      continue;
    }
    const age = postingAge(row.notes, today);
    const state = contacts.get(key) ?? {};
    if (isHeld(state, age, today, holdOnConnect)) held++;
    else scored.push(scoreRow({ row, triage, key, age, state }, scoring));
  }
  // url as the last key keeps the list identical between runs on the same files.
  scored.sort((a, b) => b.score - a.score || b.triage - a.triage || a.url.localeCompare(b.url));
  const picks = pickTop(scored, submitCounts(actionRows, keyOf, today), limits.per_company_per_day, n, rules.remainder);
  return { picks, eligible: scored.length, held, blocked, contactsMissing };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { n: 'int' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  if (!config) throw new Error('config/student.yml is missing: start the personalization interview first');
  const today = createClock({ today: flags.today, timezone: config.timezone }).today();
  const read = (name) => readIf(join(paths.dataDir, name));
  const res = rankQueue({
    doc: parsePipeline(read('pipeline.md')),
    config,
    today,
    actionRows: await readActionLog(join(paths.dataDir, 'action-log.tsv')),
    contactsText: read('contacts.tsv'),
    connectionsText: read('Connections.csv'),
    applicationsText: read('applications.md'),
    n: flags.n ?? config.daily_target,
  });
  if (res.contactsMissing.length) {
    console.error(`rank-queue: contacts.tsv has no ${res.contactsMissing.join(' or ')} column for contacts_format status-notes; contact state ignored`);
  }
  if (flags.json) console.log(JSON.stringify(res.picks, null, 2));
  else {
    const blocked = res.blocked > 0 ? `, ${res.blocked} blocked by caps, track or reserved-slot rules` : '';
    console.log(`Top ${res.picks.length} of ${res.eligible} eligible (${res.held} waiting on referral timing)${blocked}`);
    res.picks.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.score}  ${r.triage.toFixed(1)}  ${r.company} | ${r.title}${r.why ? `  [${r.why}]` : ''}\n    ${r.url}`));
  }
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
