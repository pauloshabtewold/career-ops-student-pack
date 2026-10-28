// Assumed: scripts/pilot-report.mjs runs as a CLI: `pilot-report.mjs --root R --data-dir D --today YYYY-MM-DD`.
// It reads data/action-log.tsv (actions linkedin.connect, linkedin.accept, linkedin.message, linkedin.warning,
// handshake.warning, apply.submit) and data/applications.md (Date column picks the week, Status column the count).
// Output: one line per ISO week, starting with the week label such as 2026-W43, then 'label=N' pairs for
// requests, accepts, messages, warnings, submits, responses, assessments, interviews and offers, plus the
// acceptance rate as a percentage. Only labels and numbers are printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAction } from '../../lib/action-log.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const COMPANY_A = 'Zephyr Quantum Fixtures';
const COMPANY_B = 'Gadget Orchard Samples';
const SECRET_TEXT = 'UNIQUE-MESSAGE-TEXT-8841';
const SECRET_URL = 'https://www.linkedin.com/in/fixture-person-xyz';

const act = (ts, action, extra = {}) => ({ ts, date: ts.slice(0, 10), session: 's1', action, target: SECRET_URL, company: COMPANY_A, approval: '', detail: SECRET_TEXT, ...extra });

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pilot-'));
  mkdirSync(join(root, 'data'));
  const log = join(root, 'data', 'action-log.tsv');
  await appendAction(log, [
    // week 2026-W42 (Oct 12 to 18)
    act('2026-10-12T15:00:00.000Z', 'linkedin.connect'),
    act('2026-10-13T15:00:00.000Z', 'linkedin.connect'),
    act('2026-10-14T15:00:00.000Z', 'linkedin.connect', { company: COMPANY_B }),
    act('2026-10-15T15:00:00.000Z', 'linkedin.connect', { company: COMPANY_B }),
    act('2026-10-16T15:00:00.000Z', 'linkedin.accept'),
    act('2026-10-17T15:00:00.000Z', 'linkedin.accept', { company: COMPANY_B }),
    act('2026-10-17T16:00:00.000Z', 'linkedin.message'),
    act('2026-10-14T16:00:00.000Z', 'apply.submit'),
    act('2026-10-15T16:00:00.000Z', 'apply.submit', { company: COMPANY_B }),
    act('2026-10-16T16:00:00.000Z', 'apply.submit'),
    // week 2026-W43 (Oct 19 to 25)
    act('2026-10-19T15:00:00.000Z', 'linkedin.message'),
    act('2026-10-20T15:00:00.000Z', 'linkedin.message', { company: COMPANY_B }),
    act('2026-10-21T15:00:00.000Z', 'linkedin.warning'),
    act('2026-10-22T15:00:00.000Z', 'handshake.warning'),
    act('2026-10-23T15:00:00.000Z', 'apply.submit'),
  ]);
  const apps = [
    '# Applications',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    `| 1 | 2026-10-12 | ${COMPANY_A} | Fixture Role | 4.0/5 | Responded | no | none | |`,
    `| 2 | 2026-10-13 | ${COMPANY_B} | Fixture Role | 4.0/5 | Responded | no | none | |`,
    `| 3 | 2026-10-14 | ${COMPANY_A} | Fixture Role | 4.0/5 | Applied | no | none | |`,
    `| 4 | 2026-10-20 | ${COMPANY_B} | Fixture Role | 4.0/5 | Assessment | no | none | |`,
    `| 5 | 2026-10-21 | ${COMPANY_A} | Fixture Role | 4.0/5 | Interview | no | none | |`,
    `| 6 | 2026-10-22 | ${COMPANY_B} | Fixture Role | 4.0/5 | Offer | no | none | |`,
    '',
  ].join('\n');
  writeFileSync(join(root, 'data', 'applications.md'), apps);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function report(root) {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'pilot-report.mjs'), '--root', root, '--data-dir', join(root, 'data'), '--today', '2026-10-27'], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

const weekLine = (stdout, week) => stdout.split('\n').find((l) => l.includes(week)) ?? '';
const metric = (text, label) => {
  const m = new RegExp(`\\b${label}\\s*[=:]\\s*(\\d+)`).exec(text);
  return m ? Number(m[1]) : undefined;
};

// M-008-S12
test('M-008-S12 prints per-week counts for requests, accepts, messages, warnings, submits and the acceptance rate', async () => {
  const f = await fixture();
  try {
    const res = report(f.root);
    assert.equal(res.code, 0, res.stderr);
    const w42 = weekLine(res.stdout, '2026-W42');
    const w43 = weekLine(res.stdout, '2026-W43');
    assert.ok(w42 && w43, 'one line per week');
    assert.deepEqual(['requests', 'accepts', 'messages', 'warnings', 'submits'].map((k) => metric(w42, k)), [4, 2, 1, 0, 3]);
    assert.deepEqual(['requests', 'accepts', 'messages', 'warnings', 'submits'].map((k) => metric(w43, k)), [0, 0, 2, 2, 1]);
    assert.match(w42, /50(\.0+)?%/);
  } finally {
    f.cleanup();
  }
});

// M-008-S12
test('M-008-S12 prints per-week responses, assessments, interviews and offers from the tracker', async () => {
  const f = await fixture();
  try {
    const res = report(f.root);
    assert.equal(res.code, 0, res.stderr);
    const w42 = weekLine(res.stdout, '2026-W42');
    const w43 = weekLine(res.stdout, '2026-W43');
    assert.equal(metric(w42, 'responses'), 2);
    assert.deepEqual(['assessments', 'interviews', 'offers'].map((k) => metric(w42, k)), [0, 0, 0]);
    assert.deepEqual(['assessments', 'interviews', 'offers'].map((k) => metric(w43, k)), [1, 1, 1]);
  } finally {
    f.cleanup();
  }
});

// M-008-S13
test('M-008-S13 output holds no company name, URL or message text from the fixtures', async () => {
  const f = await fixture();
  try {
    const res = report(f.root);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.trim().length > 0, 'the report prints something');
    for (const secret of [COMPANY_A, COMPANY_B, 'Zephyr', 'Gadget', 'Fixture Role', SECRET_TEXT, 'fixture-person-xyz']) {
      assert.ok(!res.stdout.includes(secret), `output must not contain ${secret}`);
    }
    assert.ok(!/https?:|linkedin\.com|www\./i.test(res.stdout));
  } finally {
    f.cleanup();
  }
});
