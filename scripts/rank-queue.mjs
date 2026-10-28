#!/usr/bin/env node
// Ranked daily apply list. Read-only: it never writes a file.
// Pending rows at or above the effective score floor are scored by the weights in config.rank.weights
// (triage fit, posting age, marquee employer, metro match, warm contact, referral state), then at most
// per_company_per_day rows per company are listed, after folding parent companies together.
// Usage: rank-queue.mjs [--n N] [--json] [--root R] [--data-dir D] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { parseTsv } from '../lib/tsv.mjs';
import { CEILINGS, effectiveLimits } from './budget.mjs';

// Used only when config.rank.weights is empty; a configured map replaces it, so unlisted factors weigh nothing.
export const DEFAULT_WEIGHTS = Object.freeze({ triage: 10, age: 4, marquee: 2, metro: 1, warm: 2, referral: 5 });
const DAY_MS = 86400000;
const GENERIC = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'the', 'group', 'technologies', 'technology', 'labs', 'lab', 'software', 'systems', 'holdings']);
const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !GENERIC.has(t));
const rawKey = (s) => tokens(s).sort().join(' ');

// parent_companies: { parent: [alias, ...] } so a subsidiary counts against its parent's cap.
export function companyKey(name, parents = {}) {
  const key = rawKey(name);
  for (const [parent, aliases] of Object.entries(parents)) {
    const all = [parent, ...(Array.isArray(aliases) ? aliases : [])].map(rawKey);
    if (all.some((a) => a && (key === a || key.split(' ').includes(a)))) return rawKey(parent);
  }
  return key;
}

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

// contacts.tsv columns: date, company, name, stage (connect | accepted | referral-ask | referred).
function contactState(text, parents) {
  const state = new Map();
  for (const r of parseTsv(text).rows) {
    const key = companyKey(r.company, parents);
    if (!key) continue;
    const s = state.get(key) ?? { referred: false, warm: false, connectOn: null, askedOn: null };
    const newer = (a, b) => (!a || b > a ? b : a);
    if (r.stage === 'referred') s.referred = true;
    if (r.stage === 'accepted') s.warm = true;
    if (r.stage === 'connect') s.connectOn = newer(s.connectOn, r.date);
    if (r.stage === 'referral-ask') s.askedOn = newer(s.askedOn, r.date);
    state.set(key, s);
  }
  return state;
}

// Posting age in days from a posted~<N>d token, else from a posted=<date> or imported=<date> token.
function postingAge(notes, today) {
  for (const k of notes.keys()) {
    const m = /^posted~(\d+)d$/.exec(k);
    if (m) return Number(m[1]);
  }
  const date = notes.get('posted') ?? notes.get('imported');
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? daysBetween(date, today) : null;
}

function connectionCounts(csvText, parents) {
  const counts = new Map();
  const lines = csvText.split(/\r?\n/);
  const header = lines.findIndex((l) => /^First Name,/i.test(l));
  if (header === -1) return counts;
  const cols = lines[header].split(',');
  const at = cols.indexOf('Company');
  for (const l of lines.slice(header + 1)) {
    const company = l.split(',')[at];
    if (company) counts.set(companyKey(company, parents), (counts.get(companyKey(company, parents)) ?? 0) + 1);
  }
  return counts;
}

export function rankQueue({ doc, config, today, actionRows = [], contactsText = '', connectionsText = '', applicationsText = '', n }) {
  const { values: limits } = effectiveLimits(config);
  const floor = Math.max(CEILINGS.score_floor.value, limits.score_floor);
  const given = config.rank?.weights ?? {};
  const weights = Object.keys(given).length ? { triage: 0, age: 0, marquee: 0, metro: 0, warm: 0, referral: 0, ...given } : DEFAULT_WEIGHTS;
  const parents = config.rank?.parent_companies ?? {};
  const marquee = new Set((config.rank?.marquee ?? []).map((m) => companyKey(m, parents)));
  const metros = (config.rank?.metros ?? []).map((m) => m.toLowerCase());
  const contacts = contactState(contactsText, parents);
  const connections = connectionCounts(connectionsText, parents);

  const appliedToday = new Map();
  for (const r of actionRows) {
    if (r.action === 'apply.submit' && r.date === today && !/refus|dry/i.test(r.detail ?? '')) {
      const key = companyKey(r.company, parents);
      appliedToday.set(key, (appliedToday.get(key) ?? 0) + 1);
    }
  }
  const appliedBefore = new Set([...applicationsText.matchAll(/^\|\s*\d+\s*\|[^|]*\|\s*([^|]+?)\s*\|/gm)].map((m) => companyKey(m[1], parents)));

  const scored = [];
  let held = 0;
  for (const { row } of sectionRows(doc, 'Pending')) {
    const triage = Number(row.notes.get('triage'));
    if (!Number.isFinite(triage) || triage < floor) continue;
    const key = companyKey(row.company, parents);
    const age = postingAge(row.notes, today);
    const why = [];
    const state = contacts.get(key) ?? {};
    // A referral ask gets three days to be answered before the same company is applied to cold.
    if (state.askedOn && !state.referred && daysBetween(state.askedOn, today) < 3) {
      held++;
      continue;
    }
    // A fresh connection request may still become a referral, so the row waits unless the posting is already old.
    if (state.connectOn && !state.warm && !state.referred && daysBetween(state.connectOn, today) < 5 && !(age !== null && age > 14)) {
      held++;
      continue;
    }
    const fresh = age === null ? 0.4 : age <= 3 ? 1 : age <= 7 ? 0.8 : age <= 14 ? 0.55 : 0.3;
    const referral = state.referred ? 1 : 0;
    const warm = state.warm || connections.get(key) ? 1 : 0;
    if (state.referred) why.push('referral ready');
    if (warm) why.push('warm contact');
    if (age !== null && age <= 3) why.push('fresh');
    const inMetro = metros.length && metros.some((m) => row.location.toLowerCase().includes(m)) ? 1 : 0;
    const score =
      weights.triage * triage + weights.age * fresh + weights.marquee * (marquee.has(key) ? 1 : 0) + weights.metro * inMetro + weights.warm * warm + weights.referral * referral;
    scored.push({ url: row.url, company: row.company, title: row.title, location: row.location, triage, score: Math.round(score * 10) / 10, why: why.join(', '), key, applied: appliedBefore.has(key) });
  }
  // url as the last key keeps the list identical between runs on the same files.
  scored.sort((a, b) => b.score - a.score || b.triage - a.triage || a.url.localeCompare(b.url));
  const perCompany = new Map(appliedToday);
  const picks = [];
  for (const r of scored) {
    if ((perCompany.get(r.key) ?? 0) >= limits.per_company_per_day) continue;
    perCompany.set(r.key, (perCompany.get(r.key) ?? 0) + 1);
    picks.push(r);
    if (picks.length >= n) break;
  }
  return { picks, eligible: scored.length, held };
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
  if (flags.json) console.log(JSON.stringify(res.picks, null, 2));
  else {
    console.log(`Top ${res.picks.length} of ${res.eligible} eligible (${res.held} waiting on referral timing)`);
    res.picks.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.score}  ${r.triage.toFixed(1)}  ${r.company} | ${r.title}${r.why ? `  [${r.why}]` : ''}\n    ${r.url}`));
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
