#!/usr/bin/env node
// Inbox step. Works only on mail the student pastes or the Gmail connector hands over as a JSON file; it never
// logs in, fetches or follows a link, and nothing it prints carries message text or links.
// Usage: inbox.mjs --backend connector --input F | paste --file F | gmail-plugin
//                  [--root R] [--data-dir D] [--today YYYY-MM-DD] [--dry-run] [--propose-only]
// Status changes go only through upstream set-status.mjs. Seen message ids live in data/.student-inbox-seen.
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { effectiveLimits } from './budget.mjs';

const BACKENDS = ['connector', 'paste', 'gmail-plugin'];
const DAY_MS = 86400000;
const ALERT_DOMAINS = { 'linkedin.com': 'linkedin-alert', 'joinhandshake.com': 'handshake-alert' };

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function isoDate(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function pasteMessages(text) {
  const blocks = String(text).split(/\r?\n---\r?\n|\r?\n---\s*$/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const head = {};
    let i = 0;
    for (; i < lines.length; i++) {
      const m = /^(Id|From|Subject|Date):\s*(.*)$/i.exec(lines[i]);
      if (m) head[m[1].toLowerCase()] = m[2];
      else if (lines[i].trim() === '' && Object.keys(head).length) break;
      else if (lines[i].trim() !== '') break;
    }
    if (!head.id) continue;
    out.push({ id: head.id, from: head.from, subject: head.subject, snippet: lines.slice(i + 1).join('\n'), date: head.date });
  }
  return out;
}

// Both input paths end in the same shape so one classifier serves them.
export function normalize(backend, payload) {
  let raw;
  if (backend === 'connector') raw = Array.isArray(payload) ? payload : [];
  else if (backend === 'paste') raw = pasteMessages(payload);
  else throw new UsageError(`backend ${backend} has no message input`);
  return raw.map((m) => ({
    id: squash(m.id),
    from: squash(m.from),
    subject: squash(m.subject),
    snippet: squash(m.snippet),
    date: isoDate(m.date),
  }));
}

const senderAddress = (from) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const senderDomain = (from) => senderAddress(from).split('@').pop().replace(/[^a-z0-9.-]/g, '');
const underDomain = (domain, base) => domain === base || domain.endsWith(`.${base}`);

function companyFor(domain, companies) {
  const labels = new Set(domain.split('.').map(compact));
  return companies.find((c) => (c.domains ?? []).some((d) => underDomain(domain, d.toLowerCase())) || labels.has(compact(c.name))) ?? null;
}

const SUSPICIOUS = [
  /\b(ssn|social security)\b/i,
  /\bbank (account|details|routing|login)\b|\brouting number\b|\baccount number\b/i,
  /\bpassword\b/i,
  /\bverif(y|ication)\b[^.]{0,40}\blink\b|\blink\b[^.]{0,40}\bverify\b/i,
  /\b(ignore|disregard) (all |any )?(previous|prior|above) (instructions|messages)\b|\b(ai|llm) (assistant|agent|model)\b|\bdear (ai|assistant|claude)\b/i,
];
const REJECTION = /\b(move|moving|proceed|proceeding) forward with (other|another)\b|\bregret to inform\b|\bunfortunately\b|\bnot (be )?(moving|selected|proceeding)\b|\bdecided not to\b|\bposition has been filled\b/i;
const CONFIRMATION = /\bautomated\b|\bdo not reply\b|\bdon't reply\b|\breceived your application\b|\bthank(s| you) for applying\b/i;
const INTERVIEW = /\binterview\b/i;
const SCHEDULING = /\b(availability|schedul(e|ing)|calendly|book a (time|slot)|(few|some) times|times (that |which )?(work|suit)|a call|phone screen)\b/i;
const ASKS = /\?|\bplease (send|provide|reply|respond|complete|fill|upload|confirm|let us know)\b/i;
const DUE = /\b(\d{4}-\d{2}-\d{2})\b/;

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// A company name matches only as whole words, so "Apple" never hits "Pineapple Corp"; the longest name wins.
function findCompany(text, companies) {
  const haystack = words(text);
  const hits = (name) => {
    const needle = words(name);
    if (!needle.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      if (needle.every((w, k) => haystack[i + k] === w)) return true;
    }
    return false;
  };
  return companies.filter((c) => hits(c.name)).sort((x, y) => compact(y.name).length - compact(x.name).length)[0] ?? null;
}

function alertRow(m, label) {
  const at = m.subject.lastIndexOf(' at ');
  if (at < 1) return null;
  const clean = (s) => squash(s.replace(/\S*linkedin\.com\S*/gi, '').replace(/[|;]/g, ','));
  const link = /https?:\/\/[^\s)>\]]+/.exec(m.snippet)?.[0] ?? '';
  let jobId = '';
  try {
    jobId = new URL(link).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    jobId = '';
  }
  const title = clean(m.subject.slice(0, at));
  const company = clean(m.subject.slice(at + 4));
  return title && company ? { label, title, company, jobId: /^[A-Za-z0-9_-]+$/.test(jobId) ? jobId : '' } : null;
}

// ctx = { assessmentDomains, companies: [{ name, domains? }] }; returns { kind, ... } and never reads outside the message.
export function classify(message, ctx) {
  const text = `${message.subject} ${message.snippet}`;
  const domain = senderDomain(message.from);
  const base = { id: message.id };
  if (SUSPICIOUS.some((re) => re.test(text))) return { ...base, kind: 'suspicious' };
  for (const [alertDomain, label] of Object.entries(ALERT_DOMAINS)) {
    if (underDomain(domain, alertDomain)) {
      const row = alertRow(message, label);
      return row ? { ...base, kind: 'alert', ...row } : { ...base, kind: 'ignore' };
    }
  }
  const sender = companyFor(domain, ctx.companies);
  const assess = (ctx.assessmentDomains ?? []).find((d) => underDomain(domain, d.toLowerCase()));
  const company = sender ?? (assess ? findCompany(text, ctx.companies) : null);
  if (!company && !assess) return { ...base, kind: 'ignore' };
  const info = { ...base, company: company?.name ?? '' };
  if (company) {
    if (REJECTION.test(text)) return { ...info, kind: 'rejection' };
    if (!assess && CONFIRMATION.test(text)) return { ...info, kind: 'ignore' };
    if (INTERVIEW.test(text)) return { ...info, kind: 'interview' };
    if (SCHEDULING.test(text)) return { ...info, kind: 'scheduling' };
  }
  if (assess) {
    const due = DUE.exec(text)?.[1] ?? 'unknown';
    return { ...info, kind: 'assessment', note: `OA ${assess.split('.')[0]}, due ${due}` };
  }
  if (ASKS.test(text)) return { ...info, kind: 'question' };
  return { ...info, kind: 'reply' };
}

function trackerCompanies(text) {
  const byName = new Map();
  for (const raw of text.split('\n')) {
    const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (raw.trim().startsWith('|') && /^\d+$/.test(cells[0]) && cells[2]) {
      const entry = byName.get(cells[2]) ?? { name: cells[2], rows: [] };
      entry.rows.push({ num: cells[0], status: cells[5] ?? '' });
      byName.set(cells[2], entry);
    }
  }
  return [...byName.values()];
}

export const defaultRunner = (argv, { cwd }) =>
  new Promise((done) => {
    execFile(process.execPath, argv, { cwd, encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '' });
    });
  });

const PROPOSAL_TEXT = {
  rejection: 'looks like a rejection; consider Rejected',
  interview: 'asks for an interview; consider Interview',
  scheduling: 'asks to schedule; reply needed',
  question: 'asks a question; reply needed',
  conflict: 'conflicting mail on the same day; check by hand',
  assessment: 'assessment sender but no tracker company found; check by hand',
  held: 'status is already past this step; check by hand',
};
const UPGRADABLE = /^(evaluated|applied|responded)?$/i;

function loadMessages(backend, flags) {
  if (backend === 'connector') {
    if (!flags.input) throw new UsageError('--backend connector needs --input <json file>');
    return normalize('connector', JSON.parse(readFileSync(flags.input, 'utf8')));
  }
  if (!flags.file) throw new UsageError('--backend paste needs --file <text file>');
  return normalize('paste', readFileSync(flags.file, 'utf8'));
}

// Two different outcomes for one company on one day cannot both be right, so none is applied.
function conflictChecker(results) {
  const keyOf = (m, c) => `${compact(c.company)}|${m.date.slice(0, 10)}`;
  const outcomes = new Map();
  for (const { m, c } of results) {
    if (!c.company || !['assessment', 'reply', 'question', 'rejection', 'interview', 'scheduling'].includes(c.kind)) continue;
    outcomes.set(keyOf(m, c), new Set([...(outcomes.get(keyOf(m, c)) ?? []), c.kind]));
  }
  return (m, c) => c.company && (outcomes.get(keyOf(m, c))?.size ?? 0) > 1;
}

async function applyStatus({ m, c }, env) {
  const { companies, flags, runner, paths, out } = env;
  const entry = companies.find((x) => x.name === c.company);
  const row = entry?.rows[entry.rows.length - 1];
  const status = c.kind === 'assessment' ? 'Assessment' : 'Responded';
  if (!row) out.proposed.push(`- ${m.id} ${PROPOSAL_TEXT.assessment}`);
  else if (!UPGRADABLE.test(row.status)) out.proposed.push(`- ${m.id} ${c.company}: ${PROPOSAL_TEXT.held}`);
  else if (flags.proposeOnly || flags.dryRun) out.proposed.push(`- ${m.id} ${c.company}: set ${status}`);
  else {
    const args = ['set-status.mjs', row.num, status, ...(c.kind === 'assessment' ? ['--note', c.note] : [])];
    const res = await runner(args, { cwd: paths.root });
    if (res.code !== 0) out.failedIds.add(m.id);
    out.applied.push(res.code === 0 ? `- ${m.id} ${c.company}: ${status}` : `- ${m.id} ${c.company}: set-status failed (exit ${res.code})`);
    out.notices.push(`${c.company}: marked ${status}`);
  }
}

async function handleResult(item, env) {
  const { m, c } = item;
  const { out, clock } = env;
  if (c.kind === 'suspicious') {
    out.suspicious.push(`- ${m.id} asks for sensitive details or a link; do not reply or click`);
    out.notices.push(`suspicious message ${m.id}, see the digest`);
  } else if (c.kind === 'alert') {
    const note = [`src=${c.label}`, ...(c.jobId ? [`extid=${c.jobId}`] : []), `imported=${clock.today()}`].join('; ');
    out.stagingRows.push(`- [ ] needs-url | ${c.company} | ${c.title} | unknown | note: ${note}`);
  } else if (env.conflicted(m, c)) {
    out.proposed.push(`- ${m.id} ${c.company}: ${PROPOSAL_TEXT.conflict}`);
    out.notices.push(`${c.company}: conflicting mail, check the digest`);
  } else if (c.kind === 'assessment' || c.kind === 'reply') {
    await applyStatus(item, env);
  } else if (PROPOSAL_TEXT[c.kind]) {
    out.proposed.push(`- ${m.id} ${c.company}: ${PROPOSAL_TEXT[c.kind]}`);
    out.notices.push(`${c.company}: mail needs a look, see the digest`);
  }
}

function persist({ paths, flags, out, fresh, seenFile }) {
  mkdirSync(paths.dataDir, { recursive: true });
  if (out.stagingRows.length) {
    const stagingFile = join(paths.dataDir, 'pipeline.staging.md');
    const have = existsSync(stagingFile) ? readFileSync(stagingFile, 'utf8') : '';
    const add = [...new Set(out.stagingRows)].filter((r) => !have.includes(r.replace(/; imported=[^;]*$/, '')));
    if (add.length) appendFileSync(stagingFile, `${have && !have.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
  }
  const done = flags.proposeOnly ? [] : fresh.filter((m) => !out.failedIds.has(m.id));
  if (done.length) appendFileSync(seenFile, `${done.map((m) => m.id).join('\n')}\n`);
}

export async function main(argv, deps = {}) {
  const { flags } = parseArgs(argv, { flags: { backend: 'string', input: 'string', file: 'string', 'propose-only': 'boolean' } });
  const print = deps.out ?? ((l) => console.log(l));
  const runner = deps.runner ?? defaultRunner;
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  const backend = flags.backend ?? config?.mailbox?.backend ?? 'connector';
  if (!BACKENDS.includes(backend)) throw new UsageError(`--backend must be one of: ${BACKENDS.join(', ')}`);

  if (backend === 'gmail-plugin') {
    const res = await runner(['plugins.mjs', 'run', 'gmail'], { cwd: paths.root });
    print(`gmail plugin ${res.code === 0 ? 'ran' : `failed (exit ${res.code})`}; it feeds job discovery only, so replies need the connector or paste backend`);
    return 0;
  }

  const messages = loadMessages(backend, flags);
  const limits = effectiveLimits(config ?? {}).values;
  const clock = createClock({ today: flags.today, timezone: config?.timezone });
  const cutoff = clock.now().getTime() - limits.inbox_lookback_days * DAY_MS;
  const seenFile = join(paths.dataDir, '.student-inbox-seen');
  const seen = new Set(existsSync(seenFile) ? readFileSync(seenFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : []);
  const assessmentDomains = deps.assessmentDomains ?? loadMerged(config?.presets ?? [])?.assessment_domains ?? [];
  const appsFile = join(paths.dataDir, 'applications.md');
  const companies = trackerCompanies(existsSync(appsFile) ? readFileSync(appsFile, 'utf8') : '');
  const ctx = { assessmentDomains, companies };

  const fresh = [];
  for (const m of messages) {
    if (!m.id || seen.has(m.id) || !m.date || Date.parse(m.date) < cutoff) continue;
    seen.add(m.id);
    fresh.push(m);
  }
  const results = fresh.map((m) => ({ m, c: classify(m, ctx) }));
  const out = { applied: [], proposed: [], suspicious: [], stagingRows: [], notices: [], failedIds: new Set() };
  const env = { companies, flags, runner, paths, out, clock, conflicted: conflictChecker(results) };
  for (const item of results) await handleResult(item, env);

  for (const [heading, bullets] of [['Status updates applied', out.applied], ['Proposed status changes', out.proposed], ['Suspicious', out.suspicious]]) {
    if (!bullets.length) continue;
    for (const l of [`## ${heading}`, ...bullets, '']) print(l);
  }
  for (const n of out.notices.slice(0, limits.notifications_per_run)) print(`notice: ${n}`);

  if (!flags.dryRun) persist({ paths, flags, out, fresh, seenFile });
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(() => main(process.argv.slice(2)));
