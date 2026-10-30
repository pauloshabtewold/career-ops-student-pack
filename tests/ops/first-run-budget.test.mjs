// Assumed: firstRun({ root, dataDir, packRoot, today, shown, runner, out }) lists at most the rows left in the first-run
// triage budget (config triage_budget.first_run, default 60) minus the first-run rows in data/triage-usage.tsv, and the
// report carries a 'First-run triage budget' line. Scratch roots only; the upstream scripts are fake stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';
import { defaultRunner } from '../../lib/upstream.mjs';

function setup({ rows = 25, config = '', ledger = [] } = {}) {
  const up = createFakeUpstream();
  const pending = Array.from({ length: rows }, (_, i) => line(jobUrl(i + 1), 'Example Robotics', `Data Intern ${i + 1}`, 'Remote', 'src=handshake; imported=2026-10-27'));
  writeFileSync(join(up.root, 'config', 'student.yml'), `timezone: America/Chicago\npresets: []\n${config}`);
  writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending }));
  writeFileSync(join(up.root, 'data', 'pipeline.staging.md'), '');
  writeFileSync(join(up.root, 'data', 'applications.md'), '# Applications\n');
  if (ledger.length) writeFileSync(join(up.root, 'data', 'triage-usage.tsv'), `date\tsource\trows\toutcome\n${ledger.map((l) => `${l}\n`).join('')}`);
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

async function report(s) {
  const out = [];
  await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, runner: defaultRunner, out: (l) => out.push(String(l)) });
  return { out, text: out.join('\n'), listed: out.filter((l) => l.includes('https://example.com/jobs/')).length };
}

const firstRunRows = (n) => `2026-10-20\tfirst-run\t${n}\tok`;

// M-002-S7
test('M-002-S7 with no ledger the report prints the 60-row first-run budget and lists 20 rows', async () => {
  const s = setup();
  try {
    const { out, listed } = await report(s);
    assert.ok(out.includes('First-run triage budget: 60 rows (0 scored so far, batches of 20)'), out.join('\n'));
    assert.equal(listed, 20);
  } finally {
    s.cleanup();
  }
});

// M-002-S7
test('M-002-S7 with 50 first-run rows logged the report lists 10 rows and names the rows still untriaged', async () => {
  const s = setup({ ledger: [firstRunRows(50)] });
  try {
    const { out, listed, text } = await report(s);
    assert.ok(out.includes('First-run triage budget: 60 rows (50 scored so far, batches of 20)'), text);
    assert.equal(listed, 10);
    assert.match(text, /\.\.\. and 15 more untriaged Pending rows/);
  } finally {
    s.cleanup();
  }
});

// M-002-S7
test('M-002-S7 with 60 first-run rows logged the report lists none and says the daily triage scores the rest', async () => {
  const s = setup({ ledger: [firstRunRows(40), firstRunRows(20)] });
  try {
    const { text, listed } = await report(s);
    assert.equal(listed, 0, text);
    assert.match(text, /first-run triage budget used \(60 of 60\); the daily triage scores the rest/);
  } finally {
    s.cleanup();
  }
});

// M-002-S7
test('M-002-S7 with first_run all the report lists 20 rows and says batches continue until none remain', async () => {
  const s = setup({ config: 'triage_budget:\n  first_run: all\n', ledger: [firstRunRows(100)] });
  try {
    const { out, listed } = await report(s);
    assert.ok(out.includes('First-run triage budget: all (batches of 20 until no untriaged rows remain)'), out.join('\n'));
    assert.equal(listed, 20);
  } finally {
    s.cleanup();
  }
});
