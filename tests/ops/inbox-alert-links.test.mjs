// scripts/inbox.mjs stageAlert reads Handshake job ids from an alert job's links array (body link targets as text,
// never opened). Fake companies and synthetic links only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInbox } from '../../scripts/inbox.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'inbox-links-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  return { root, data: join(root, 'data'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// M-002-S8-osdr
test('M-002-S8-osdr a Handshake alert link holding stu/jobs/123456 gives the row its joinhandshake job URL', async () => {
  const s = setup();
  try {
    const job = { title: 'Analyst Intern', company: 'Wingtip Partners', location: 'Austin, TX', site: 'handshake', links: ['https://app.joinhandshake.com/stu/jobs/123456?utm_source=alert_email'] };
    const message = { id: 'm-hs-2', from: 'Handshake <no-reply@joinhandshake.com>', subject: 'New job match', snippet: 'New job match.', date: FRESH, jobs: [job] };
    const input = join(s.root, 'msgs.json');
    writeFileSync(input, JSON.stringify([message]));
    const lookups = [];
    const res = await runInbox(['--backend', 'connector', '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY, '--resolve'], {
      runner: async () => ({ code: 0, stdout: '' }),
      assessmentDomains: [],
      out: () => {},
      findAtEmployer: async (row) => (lookups.push(row), { url: null, how: 'none' }),
    });
    assert.equal(res.code, 0);
    const staging = readFileSync(join(s.data, 'pipeline.staging.md'), 'utf8');
    const rows = staging.split('\n').filter((l) => l.startsWith('- [ ]'));
    assert.equal(rows.length, 1, staging);
    assert.ok(rows[0].startsWith('- [ ] https://app.joinhandshake.com/jobs/123456 | Wingtip Partners | Analyst Intern | Austin, TX'), rows[0]);
    assert.equal(lookups.length, 0, 'a Handshake id needs no employer lookup');
  } finally {
    s.cleanup();
  }
});
