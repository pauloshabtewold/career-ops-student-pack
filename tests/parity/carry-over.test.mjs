import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carriedPending, compareRankQueue } from '../../tools/parity-compare.mjs';
import { runParity } from '../../tools/parity.mjs';
import { urlKey } from '../../lib/url-key.mjs';
import { FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, PACK_ROOT, makeSource, makeStudentConfig, okRunner, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

const TODAY = '2026-10-27';
const url = (n) => `https://jobs.example.com/openings/c-${n}`;
const pick = (n, company) => ({ url: url(n), company, title: `Role ${n}` });
const picks = (...items) => JSON.stringify(items);
const prow = (u, company) => `- [ ] ${u} | ${company} | Role | Remote`;
const pipeline = (pending, flagged = []) => `# Pipeline\n\n## Pending\n\n${pending.join('\n')}\n\n## Flagged\n\n${flagged.join('\n')}\n\n## Skipped\n`;

// M-004-S1
test('M-004-S1 carriedPending returns the clean urlKey of a Pending row the after text has under Flagged', () => {
  const moved = prow(`${url(1)}?utm_source=feed&ref=abc`, 'Acme');
  const stays = prow(url(2), 'Globex');
  const before = pipeline([moved, stays]);
  const after = pipeline([stays], [moved]);
  const carried = carriedPending(before, after);
  assert.ok(carried instanceof Set);
  assert.deepEqual([...carried], [urlKey(url(1))]);
  assert.ok(![...carried].some((k) => k.includes('utm_')));
});

// M-004-S2
test('M-004-S2 a missing pick whose urlKey is carried is explained and the verdict is explained', () => {
  const baseline = picks(pick(1, 'Acme'), pick(9, 'Globex'));
  const pack = picks(pick(1, 'Acme'));
  const r = compareRankQueue('rank-queue', baseline, pack, { carried: new Set([urlKey(url(9))]) });
  assert.equal(r.missing, 1);
  assert.equal(r.added, 0);
  assert.equal(r.explained, 1);
  assert.equal(r.verdict, 'explained');
});

// M-004-S3
test('M-004-S3 an added pick with a carried urlKey stays residual', () => {
  const baseline = picks(pick(1, 'Acme'));
  const pack = picks(pick(1, 'Acme'), pick(9, 'Globex'));
  const r = compareRankQueue('rank-queue', baseline, pack, { carried: new Set([urlKey(url(9))]) });
  assert.equal(r.added, 1);
  assert.equal(r.explained, 0);
  assert.equal(r.verdict, 'fail');
});

// M-004-S3
test('M-004-S3 a missing uncarried pick of a baseline-only company stays residual', () => {
  const baseline = picks(pick(1, 'Acme'), pick(7, 'Globex'));
  const pack = picks(pick(1, 'Acme'));
  const r = compareRankQueue('rank-queue', baseline, pack, { carried: new Set([urlKey(url(99))]) });
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 0);
  assert.equal(r.verdict, 'fail');
});

// M-004-S4
test('M-004-S4 a missing pick both carried and of a shared company is explained once', () => {
  const baseline = picks(pick(1, 'Acme'), pick(2, 'Acme'));
  const pack = picks(pick(1, 'Acme'));
  const r = compareRankQueue('rank-queue', baseline, pack, { carried: new Set([urlKey(url(2))]) });
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 1);
  assert.equal(r.explained, r.added + r.missing);
  assert.equal(r.verdict, 'explained');
});

// M-004-S5
test('M-004-S5 compareRankQueue without options returns the earlier counts', () => {
  const baseline = picks(pick(1, 'Acme'), pick(3, 'Acme'), pick(5, 'Globex'));
  const pack = picks(pick(1, 'Acme'), pick(2, 'Acme'), pick(5, 'Globex'));
  const r = compareRankQueue('rank-queue', baseline, pack);
  assert.equal(r.baseline_count, 3);
  assert.equal(r.pack_count, 3);
  assert.equal(r.added, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 2);
  assert.equal(r.verdict, 'explained');
  const lone = compareRankQueue('rank-queue', picks(pick(1, 'Acme')), picks(pick(1, 'Acme'), pick(9, 'Globex')));
  assert.equal(lone.explained, 0);
  assert.equal(lone.verdict, 'fail');
});

function setup() {
  const source = makeSource();
  const scratch = join(tmp('parity-carry-run-'), 'work');
  const report = join(tmp('parity-carry-report-'), 'report.md');
  const argv = ['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--report', report, '--today', TODAY];
  return { argv, report, proc: new EventEmitter(), exits: [] };
}

const result = (stdout) => ({ code: 0, status: 0, stdout, stderr: '', output: stdout });

function moveRowToFlagged(call) {
  const file = join(call.cwd, 'data', 'pipeline.md');
  const lines = readFileSync(file, 'utf8').split('\n');
  const rowLine = lines.find((l) => l.startsWith('- [ ]'));
  writeFileSync(file, lines.filter((l) => l !== rowLine).join('\n').replace('## Flagged\n', `## Flagged\n\n${rowLine}\n`));
}

async function drive(t, mover) {
  const runner = async (call) => {
    if (call.side === 'pack' && call.stage === mover) {
      moveRowToFlagged(call);
      return result('{"flagged":1}');
    }
    if (call.side === 'baseline' && call.stage === 'rank-queue') {
      return result(JSON.stringify([{ url: FIXTURE_URL, company: FIXTURE_COMPANY, title: FIXTURE_TITLE }]));
    }
    return okRunner(call);
  };
  const code = await runParity(t.argv, { stageRunner: runner, proc: t.proc, exit: (c) => t.exits.push(c) });
  const text = existsSync(t.report) ? readFileSync(t.report, 'utf8') : '';
  return { code, text, lines: text.split('\n') };
}

const rowOf = (lines, stage) => lines.find((l) => l.startsWith(`| ${stage} |`)) ?? '';

// M-004-S6
test('M-004-S6 runParity with a merge-post that moves the Pending row to Flagged gives rank-queue explained 1', async () => {
  const r = await drive(setup(), 'merge-staging');
  assert.equal(rowOf(r.lines, 'rank-queue'), '| rank-queue | 1 | 0 | 0 | 1 | 1 | explained |', r.text);
});

// M-004-S7
test('M-004-S7 the carry-over report holds no URL, company or title of the carried row', async () => {
  const r = await drive(setup(), 'merge-staging');
  assert.ok(rowOf(r.lines, 'rank-queue').endsWith('| explained |'), r.text);
  for (const secret of [FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE]) {
    assert.ok(!r.text.includes(secret), `report leaked ${secret}`);
  }
});

// M-004-S8
test('M-004-S8 the docs/maintenance.md Parity run section names the carry-over allowance and the mirrored knobs', () => {
  const text = readFileSync(join(PACK_ROOT, 'docs', 'maintenance.md'), 'utf8');
  const start = text.indexOf('## Parity run');
  assert.ok(start >= 0);
  const rest = text.slice(start + 3);
  const next = rest.indexOf('\n## ');
  const section = next === -1 ? rest : rest.slice(0, next);
  assert.match(section, /carry-over/i);
  for (const knob of ['audit.duplicate_reason', 'rank.contacts_format', 'rank.metro_match', 'rank.hold_on_pending_connect']) {
    assert.ok(section.includes(knob), `missing ${knob}`);
  }
  assert.ok(!section.includes('—'));
});

// M-004-S9
test('M-004-S9 a row apply-triage moved out of Pending stays residual and rank-queue fails', async () => {
  const r = await drive(setup(), 'apply-triage');
  assert.equal(rowOf(r.lines, 'rank-queue'), '| rank-queue | 1 | 0 | 0 | 1 | 0 | fail |', r.text);
  assert.equal(r.code, 1);
});
