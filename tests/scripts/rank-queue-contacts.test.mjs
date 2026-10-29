// Covers M-003-S10..S16: rank-queue contact state in the stage and status-notes formats.
// Synthetic contacts only. today is the harness TODAY so MM-DD year resolution is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeRoot, runScript, line, pipelineText, jobUrl, TODAY, PACK_ROOT } from '../helpers/script-harness.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { parsePipeline } from '../../lib/pipeline-md.mjs';
import { rankQueue } from '../../scripts/rank-queue.mjs';

const mmdd = (days) => shiftDate(TODAY, days).slice(5);
const pending = (company = 'Acme') => [line(jobUrl(1), company, 'Intern A', 'Remote', 'triage=4.5; posted~3d')];
const notes = (...rows) => `# company\tnotes\n${rows.map(([c, n]) => `${c}\t${n}`).join('\n')}\n`;
const stage = (...rows) => `date\tcompany\tname\tstage\n${rows.map(([d, c, s]) => `${d}\t${c}\tPat Example\t${s}`).join('\n')}\n`;

function rank({ contactsText, rankCfg = {}, rows = pending() }) {
  const config = { daily_target: 10, score_floor: 3.0, rank: { weights: { triage: 1, referral: 5 }, ...rankCfg } };
  return rankQueue({ doc: parsePipeline(pipelineText({ pending: rows })), config, today: TODAY, contactsText });
}
const SN = { contacts_format: 'status-notes' };

// M-003-S10
test('M-003-S10 status:referred in a status-notes file adds the referral weight and why referral ready', () => {
  const res = rank({ contactsText: notes(['Acme', 'status:referred']), rankCfg: SN });
  assert.equal(res.picks.length, 1);
  assert.ok(Math.abs(res.picks[0].score - 9.5) < 1e-9, String(res.picks[0].score));
  assert.match(res.picks[0].why, /referral ready/);
  assert.deepEqual(res.contactsMissing, []);
});

// M-003-S11
test('M-003-S11 status:asked one day before today holds Acme, three days before does not', () => {
  const fresh = rank({ contactsText: notes(['Acme', `status:asked ${mmdd(-1)}`]), rankCfg: SN });
  assert.equal(fresh.held, 1);
  assert.equal(fresh.picks.length, 0);
  const old = rank({ contactsText: notes(['Acme', `status:asked ${mmdd(-3)}`]), rankCfg: SN });
  assert.equal(old.held, 0);
  assert.equal(old.picks.length, 1);
});

// M-003-S12
test('M-003-S12 status:sent <yesterday> (connect holds by default, not with do-not-contact or status:accepted', () => {
  const sent = `status:sent ${mmdd(-1)} (connect`;
  const held = rank({ contactsText: notes(['Acme', sent]), rankCfg: SN });
  assert.equal(held.held, 1);
  assert.equal(held.picks.length, 0);
  for (const extra of ['do-not-contact', 'status:accepted']) {
    const res = rank({ contactsText: notes(['Acme', `${sent}) ${extra}`]), rankCfg: SN });
    assert.equal(res.held, 0, extra);
    assert.equal(res.picks.length, 1, extra);
  }
});

// M-003-S13
test('M-003-S13 hold_on_pending_connect false lists a fresh pending connect in both formats, a fresh referral ask still holds', () => {
  const off = { hold_on_pending_connect: false };
  const y = shiftDate(TODAY, -1);
  const stageConnect = rank({ contactsText: stage([y, 'Acme', 'connect']), rankCfg: off });
  assert.equal(stageConnect.picks.length, 1);
  assert.equal(stageConnect.held, 0);
  const notesConnect = rank({ contactsText: notes(['Acme', `status:sent ${mmdd(-1)} (connect`]), rankCfg: { ...SN, ...off } });
  assert.equal(notesConnect.picks.length, 1);
  assert.equal(notesConnect.held, 0);
  const stageAsk = rank({ contactsText: stage([y, 'Acme', 'referral-ask']), rankCfg: off });
  assert.equal(stageAsk.held, 1);
  assert.equal(stageAsk.picks.length, 0);
  const notesAsk = rank({ contactsText: notes(['Acme', `status:asked ${mmdd(-1)}`]), rankCfg: { ...SN, ...off } });
  assert.equal(notesAsk.held, 1);
  assert.equal(notesAsk.picks.length, 0);
});

// M-003-S14
test('M-003-S14 a status:asked month-day after today resolves to the previous year, 13-45 is ignored', () => {
  const future = rank({ contactsText: notes(['Acme', 'status:asked 12-31']), rankCfg: SN });
  assert.equal(future.held, 0);
  assert.equal(future.picks.length, 1);
  const bad = rank({ contactsText: notes(['Acme', 'status:asked 13-45']), rankCfg: SN });
  assert.equal(bad.held, 0);
  assert.equal(bad.picks.length, 1);
  const control = rank({ contactsText: notes(['Acme', `status:asked ${mmdd(-1)}`]), rankCfg: SN });
  assert.equal(control.held, 1);
});

// M-003-S15
test('M-003-S15 the stage-format rank-queue test files pass unchanged', () => {
  const out = spawnSync(process.execPath, ['--test', 'tests/scripts/rank-queue.test.mjs', 'tests/scripts/rank-queue-knobs.test.mjs'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
});

// M-003-S16
test('M-003-S16 a status-notes header without a notes column ignores contact state and reports contactsMissing', () => {
  const header = '# company\ttitle\nAcme\tIntern\n';
  const res = rank({ contactsText: header, rankCfg: SN });
  assert.deepEqual(res.contactsMissing, ['notes']);
  assert.equal(res.picks.length, 1);
  assert.ok(Math.abs(res.picks[0].score - 4.5) < 1e-9, String(res.picks[0].score));
  assert.doesNotMatch(res.picks[0].why, /referral/);

  const r = makeRoot({ config: 'daily_target: 10\nscore_floor: 3.0\nrank:\n  contacts_format: status-notes\n  weights:\n    triage: 1\n' });
  try {
    r.write('data/pipeline.md', pipelineText({ pending: pending() }));
    r.write('data/contacts.tsv', header);
    const out = runScript('rank-queue', [], r);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stderr, /rank-queue: contacts\.tsv/);
    assert.match(out.stdout.split('\n')[0], /^Top 1 of 1 eligible/);
  } finally {
    r.cleanup();
  }
});
