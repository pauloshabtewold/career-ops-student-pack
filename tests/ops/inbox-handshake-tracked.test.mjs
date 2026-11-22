// scripts/inbox.mjs on a Handshake alert whose links are only click-tracking links: each job card's link is resolved
// through a fake fetch (deps.trackFetch) to its job-search id and the row gets its Handshake job URL; a navigation link
// adds no id, and a network failure keeps the Handshake search fallback. No network; fake tokens and ids only; no
// model call (the runner is never asked for an agent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInbox } from '../../scripts/inbox.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';
const T = (token) => `https://email.notifications.joinhandshake.com/c/${token}`;
const SCHOOL = 'https://sampleu.joinhandshake.com';

async function stage(trackFetch) {
  const root = mkdtempSync(join(tmpdir(), 'inbox-hs-tracked-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const jobs = [1, 2].map((n) => ({ title: `Analyst Intern ${n}`, company: `Wingtip ${n}`, location: 'Austin, TX', site: 'handshake' }));
    const message = { id: 'm-hs-tr', from: 'Handshake <no-reply@joinhandshake.com>', subject: 'New job matches', snippet: 'New job matches.', date: FRESH, jobs, links: [T('card1'), T('inbox'), T('card2')] };
    const input = join(root, 'msgs.json');
    writeFileSync(input, JSON.stringify([message]));
    const agentCalls = [];
    const res = await runInbox(['--backend', 'connector', '--input', input, '--root', root, '--data-dir', join(root, 'data'), '--today', TODAY], {
      runner: async (argv) => {
        agentCalls.push(argv);
        return { code: 0, stdout: '' };
      },
      trackFetch,
      assessmentDomains: [],
      out: () => {},
    });
    assert.equal(res.code, 0);
    assert.deepEqual(agentCalls, [], 'no child process and no model call');
    return readFileSync(join(root, 'data', 'pipeline.staging.md'), 'utf8').split('\n').filter((l) => l.startsWith('- [ ]'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('tracking-only Handshake alert links resolve to job ids and the rows get their Handshake job URLs', async () => {
  const locs = { card1: `${SCHOOL}/job-search/90000011`, card2: `${SCHOOL}/job-search/90000022`, inbox: `${SCHOOL}/inbox` };
  const rows = await stage(async (url) => new Response(null, { status: 302, headers: { location: locs[new URL(url).pathname.split('/').pop()] } }));
  assert.ok(rows.some((r) => r.startsWith('- [ ] https://app.joinhandshake.com/jobs/90000011 | Wingtip 1 |')), rows.join('\n'));
  assert.ok(rows.some((r) => r.startsWith('- [ ] https://app.joinhandshake.com/jobs/90000022 | Wingtip 2 |')), rows.join('\n'));
});

test('a network failure keeps the Handshake search fallback', async () => {
  const rows = await stage(async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  });
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r, /stu\/postings\?query=.*check=url/);
});
