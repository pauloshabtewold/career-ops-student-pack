// Shared fixtures for the P3 outreach tests: synthetic contacts and companies, a data/contacts.tsv writer (columns date,
// company, name, stage; one row per event), a logged batch.approve for an outreach batch, budget check builders for the
// send kinds, and a runner for `scripts/outreach-state.mjs due` that pins the clock through --today.
// Every name, company and address here is a placeholder; addresses use the reserved example.com domain.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeTsv } from '../../lib/tsv.mjs';
import { DAY, PACK_ROOT, TZ, run } from './budget-harness.mjs';

export const A = 'Contact Alpha';
export const B = 'Contact Beta';
export const C = 'Contact Gamma';
export const ACME = 'Acme Example';
export const GLOBEX = 'Globex Example';
export const EMAIL = { [A]: 'alpha@example.com', [B]: 'beta@example.com', [C]: 'gamma@example.com' };
export const OB = '2026-03-10-outreach-1';
export const CONTACT_HEADER = ['date', 'company', 'name', 'stage'];
export const OUTREACH_STATE_CLI = join(PACK_ROOT, 'scripts', 'outreach-state.mjs');

export const contact = (date, company, name, stage) => ({ date, company, name, stage });

export function writeContacts(dataDir, rows) {
  writeFileSync(join(dataDir, 'contacts.tsv'), serializeTsv(CONTACT_HEADER, rows));
}

export const out = (r) => r.stdout + r.stderr;

// Logs the student's approval of outreach batch items through the budget CLI.
export function approve(pack, items = '1,2,3', { id = OB, today = DAY } = {}) {
  const r = run(pack, ['log', 'batch.approve', '--batch-id', id, '--items', items, '--approval', 'approve all'], { today });
  if (r.code !== 0) throw new Error(`batch.approve fixture failed: ${out(r)}`);
  return r;
}

const item = (n, id) => (n === null ? [] : ['--batch-id', id, '--item', String(n)]);

export const connectCheck = (pack, target, company, n, { id = OB, today = DAY } = {}) =>
  run(pack, ['check', 'linkedin.connect', '--target', target, '--company', company, '--pending', '50', ...item(n, id), '--approval', 'send all'], { today });

export const messageCheck = (pack, target, company, n, { id = OB, today = DAY } = {}) =>
  run(pack, ['check', 'linkedin.message', '--target', target, '--company', company, '--length', '120', ...item(n, id), '--approval', 'send all'], { today });

export const nudgeCheck = (pack, target, company, n, { id = OB, today = DAY } = {}) =>
  run(pack, ['check', 'linkedin.nudge', '--target', target, '--company', company, ...item(n, id), '--approval', 'send all'], { today });

export const emailCheck = (pack, target, company, n, { id = OB, today = DAY, extra = [] } = {}) =>
  run(pack, ['check', 'gmail.send', '--target', target, '--company', company, '--email', EMAIL[target], ...item(n, id), '--approval', 'send all', ...extra], { today });

export const followupCheck = (pack, target, company, n, { id = OB, today = DAY } = {}) =>
  run(pack, ['check', 'apply.followup', '--target', target, '--company', company, ...item(n, id), '--approval', 'send all'], { today });

// `outreach-state.mjs due` for one scratch pack.
export function due(pack, { today = DAY } = {}) {
  const r = spawnSync(process.execPath, [OUTREACH_STATE_CLI, 'due', '--root', pack.root, '--data-dir', pack.dataDir, '--today', today], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Lines of the due output that name a contact (and a company, when given).
export const linesFor = (text, name, company = null) => text.split('\n').filter((l) => l.includes(name) && (company === null || l.includes(company)));
export const openerLines = (text, name, company = null) => linesFor(text, name, company).filter((l) => /opener/i.test(l));

// The local date today in the harness timezone, for flows whose budget call runs on the real clock.
export const realToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// contactRecords may return an array, a Map or a keyed object; the tests read it as a list.
export const asList = (records) => (records instanceof Map ? [...records.values()] : Array.isArray(records) ? records : Object.values(records ?? {}));

// nextAction may return a kind string or an object carrying one; the tests read the kind.
export const kindOf = (a) => (typeof a === 'string' ? a : [a?.kind, a?.action, a?.type].find((v) => typeof v === 'string') ?? JSON.stringify(a ?? null));
