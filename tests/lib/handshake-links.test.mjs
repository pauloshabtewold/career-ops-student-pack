// lib/handshake-links.mjs extractHandshakeId(href) plus the inbox staging of a Handshake alert with no extractable id.
// Synthetic links and fake companies only; no URL is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'hs-links-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  return { root, data: join(root, 'data'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// M-002-S15-osdr
test('M-002-S15-osdr a percent-encoded redirect target yields the id and an alert with no id lands in Pending with check=url', async () => {
  const { extractHandshakeId } = await import('../../lib/handshake-links.mjs');
  const encoded = `https://click.example.com/ls/click?upn=${encodeURIComponent('https://app.joinhandshake.com/stu/jobs/654321?ref=alert')}`;
  assert.equal(extractHandshakeId(encoded), '654321');
  const b64 = `https://click.example.com/r?t=${Buffer.from('https://app.joinhandshake.com/jobs/777888').toString('base64')}`;
  assert.equal(extractHandshakeId(b64), '777888');
  assert.equal(extractHandshakeId('https://app.joinhandshake.com/job-search/5550001?page=1'), '5550001');
  assert.equal(extractHandshakeId('https://app.joinhandshake.com/notifications/settings'), null);

  const { runInbox } = await import('../../scripts/inbox.mjs');
  const s = setup();
  try {
    const job = { title: 'Analyst Intern', company: 'Wingtip Partners', location: 'Austin, TX', site: 'handshake', links: ['https://app.joinhandshake.com/notifications/settings'] };
    const message = { id: 'm-hs-1', from: 'Handshake <no-reply@joinhandshake.com>', subject: 'New job match', snippet: 'New job match.', date: FRESH, jobs: [job] };
    const input = join(s.root, 'msgs.json');
    writeFileSync(input, JSON.stringify([message]));
    const res = await runInbox(['--backend', 'connector', '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY, '--resolve'], {
      runner: async () => ({ code: 0, stdout: '' }),
      assessmentDomains: [],
      out: () => {},
      findAtEmployer: async () => ({ url: null, how: 'none' }),
    });
    assert.equal(res.code, 0);
    const staging = readFileSync(join(s.data, 'pipeline.staging.md'), 'utf8');
    const rows = staging.split('\n').filter((l) => l.startsWith('- [ ]') && l.includes('Wingtip Partners'));
    assert.equal(rows.length, 1, staging);
    assert.match(rows[0], /check=url/, rows[0]);
  } finally {
    s.cleanup();
  }
});
