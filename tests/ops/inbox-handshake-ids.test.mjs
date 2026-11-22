// scripts/inbox.mjs stageAlert gives id-less Handshake jobs the ids from the message's body links by position only when
// there is exactly one id per id-less job; with a mismatch no job takes another job's id. Fake companies and synthetic
// links only, never opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInbox } from '../../scripts/inbox.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';

async function stage(jobs, links) {
  const root = mkdtempSync(join(tmpdir(), 'inbox-hs-ids-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const message = { id: 'm-hs-ids', from: 'Handshake <no-reply@joinhandshake.com>', subject: 'New job matches', snippet: 'New job matches.', date: FRESH, jobs, links };
    const input = join(root, 'msgs.json');
    writeFileSync(input, JSON.stringify([message]));
    const res = await runInbox(['--backend', 'connector', '--input', input, '--root', root, '--data-dir', join(root, 'data'), '--today', TODAY], { runner: async () => ({ code: 0, stdout: '' }), assessmentDomains: [], out: () => {} });
    assert.equal(res.code, 0);
    return readFileSync(join(root, 'data', 'pipeline.staging.md'), 'utf8').split('\n').filter((l) => l.startsWith('- [ ]'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const job = (n) => ({ title: `Analyst Intern ${n}`, company: `Wingtip ${n}`, location: 'Austin, TX', site: 'handshake' });
const link = (id) => `https://app.joinhandshake.com/stu/jobs/${id}?utm_source=alert_email`;

test('M-002 three id-less Handshake jobs and two link ids: no job is staged on another job\'s id', async () => {
  const rows = await stage([job(1), job(2), job(3)], [link(111111), link(333333)]);
  for (const r of rows) assert.ok(!/\/jobs\/(111111|333333)\b/.test(r), `no positional id with a count mismatch: ${r}`);
});

test('M-002 one link id per id-less Handshake job still gives each job its id in order', async () => {
  const rows = await stage([job(1), job(2)], [link(111111), link(222222)]);
  assert.ok(rows.some((r) => r.includes('/jobs/111111 | Wingtip 1 |')), rows.join('\n'));
  assert.ok(rows.some((r) => r.includes('/jobs/222222 | Wingtip 2 |')), rows.join('\n'));
});
