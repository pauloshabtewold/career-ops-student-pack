// Live proof 2026-11-10: the digest dropped github-lists counts behind a deferral warning and hid scan board errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ingestSteps } from '../../lib/ingest.mjs';
import { oneLine } from '../../lib/text.mjs';
import { scanErrorLine, scanFileCounts } from '../../lib/scan-errors.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const STATS = 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\n';
const RUNS = 'timestamp\tstatus\tcompanies\tboards\tfound\terrors\n';
const HEALTH = 'timestamp\tcompany\tstatus\n';

test('github-lists: the count line comes first and the deferral warning is an extra line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-truth-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), STATS);
    const runner = (cmd, args) => {
      if (basename(args[0]) !== 'plugins.mjs') return '';
      appendFileSync(join(dir, 'student-github-stats.tsv'), '2026-11-10\talpha-list\t120\t105\t0\t0\t0\n2026-11-10\tbeta-list\t90\t25\t2\t0\t0\n');
      return 'github-lists: beta-list: 23 row(s) deferred, time budget reached\ngithub-lists ingest: 2 found, 0 new.\n';
    };
    let out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    assert.equal(oneLine(out), 'github-lists: 2 list(s) read, 130 eligible postings, 2 new rows');
    assert.match(out.split('\n')[1], /23 row\(s\) deferred, time budget reached/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan errors: board names and reasons come from this scan only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-truth-'));
  try {
    writeFileSync(join(dir, 'scan-runs.tsv'), `${RUNS}2026-11-09T01:00:00Z\tcompleted\t5\t0\t10\t1\n`);
    writeFileSync(join(dir, 'portal-health.tsv'), `${HEALTH}2026-11-09T01:00:00Z\tOldCo\tnetwork\n`);
    const before = scanFileCounts(dir);
    appendFileSync(join(dir, 'scan-runs.tsv'), '2026-11-10T01:00:00Z\tcompleted\t5\t0\t10\t2\n');
    appendFileSync(join(dir, 'portal-health.tsv'), '2026-11-10T01:00:00Z\tAcme Fake\tauth\n2026-11-10T01:00:00Z\tOkCo\treachable\n2026-11-10T01:00:00Z\tBeta Fake\tauth\n');
    assert.equal(scanErrorLine(dir, before), 'scan: 2 boards failed: Acme Fake (auth), Beta Fake (auth)');
    assert.equal(scanErrorLine(dir, scanFileCounts(dir)), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the daily digest lists scan errors under Failures', () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
    const data = join(up.root, 'data');
    writeFileSync(join(data, 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
    writeFileSync(join(data, 'scan-runs.tsv'), RUNS);
    writeFileSync(join(data, 'portal-health.tsv'), HEALTH);
    // The fake scan appends nothing, so the real scan's rows are simulated by a wrapper that writes them first.
    const wrap = join(up.root, 'wrap.mjs');
    writeFileSync(wrap, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(join(data, 'scan-runs.tsv'))}, '2026-11-10T01:00:00Z\\tcompleted\\t5\\t0\\t10\\t1\\n');\nappendFileSync(${JSON.stringify(join(data, 'portal-health.tsv'))}, '2026-11-10T01:00:00Z\\tAcme Fake\\tauth\\n');\n`);
    const scanFile = join(up.root, 'scan.mjs');
    appendFileSync(scanFile, `\nawait import(${JSON.stringify(wrap)});\n`);
    const res = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', data, '--today', '2026-11-10'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(res.status, 0, res.stderr);
    const digest = readFileSync(join(data, 'digest', 'student-2026-11-10.md'), 'utf8');
    assert.match(digest, /## Failures\n- scan: 1 board failed: Acme Fake \(auth\)\n/);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
