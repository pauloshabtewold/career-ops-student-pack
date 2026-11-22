// scripts/inbox.mjs, M-003 second fix round: a --dry-run pass resolves no Handshake click-tracking link (no GET at all),
// and a real pass stops resolving once its lookup deadline has passed. Fake fetch, fake clock, fake tokens; no network and
// no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInbox } from '../../scripts/inbox.mjs';

const T = (token) => `https://email.notifications.joinhandshake.com/c/${token}`;

async function pass(extra, deps) {
  const root = mkdtempSync(join(tmpdir(), 'inbox-tracked-dry-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const message = (id) => ({ id, from: 'Handshake <no-reply@joinhandshake.com>', subject: 'New job matches', snippet: 'New job matches.', date: '2026-10-26T15:00:00.000Z', jobs: [{ title: 'Analyst Intern', company: 'Wingtip', location: 'Austin, TX', site: 'handshake' }], links: [T(`card-${id}`)] });
    writeFileSync(join(root, 'msgs.json'), JSON.stringify([message('m1'), message('m2')]));
    const res = await runInbox(['--backend', 'connector', '--input', join(root, 'msgs.json'), '--root', root, '--data-dir', join(root, 'data'), '--today', '2026-10-27', ...extra], {
      runner: async () => ({ code: 0, stdout: '' }),
      assessmentDomains: [],
      out: () => {},
      ...deps,
    });
    assert.equal(res.code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a dry run makes no tracking-link GET', async () => {
  const gets = [];
  await pass(['--dry-run'], { trackFetch: async (url) => (gets.push(url), new Response(null, { status: 404 })) });
  assert.deepEqual(gets, []);
});

test('a real run stops resolving tracking links after its deadline', async () => {
  const gets = [];
  let t = 0;
  const trackFetch = async (url) => {
    gets.push(url);
    t += 6 * 60 * 1000;
    return new Response(null, { status: 404 });
  };
  await pass([], { trackFetch, now: () => t });
  assert.deepEqual(gets, [T('card-m1')], 'the second message comes after the 5-minute deadline');
});
