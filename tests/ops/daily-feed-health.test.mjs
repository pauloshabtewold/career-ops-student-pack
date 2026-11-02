// W-027: the daily digest gets a "## Feed health" section, and a health check that cannot run never changes the exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

function setup() {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
  const data = join(up.root, 'data');
  writeFileSync(join(data, 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
  return { up, data, cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}
const run = (up, today) => spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', today], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
const digest = (s, today) => readFileSync(join(s.data, 'digest', `student-${today}.md`), 'utf8');

test('W-027 the digest has a Feed health section and the first run flags nothing', () => {
  const s = setup();
  try {
    const res = run(s.up, '2026-10-27');
    assert.equal(res.status, 0, res.stderr);
    assert.match(digest(s, '2026-10-27'), /## Feed health\n- no feed flagged\n/);
    assert.match(readFileSync(join(s.data, 'feed-health.tsv'), 'utf8'), /2026-10-27\tgithub-lists\t0/);
  } finally {
    s.cleanup();
  }
});

test('W-027 a feed that yielded in earlier runs and adds nothing today is flagged; the run still exits 0', () => {
  const s = setup();
  try {
    writeFileSync(join(s.data, 'feed-health.tsv'), 'date\tfeed\trows\n2026-10-25\tgithub-lists\t4\n2026-10-26\tgithub-lists\t2\n');
    const res = run(s.up, '2026-10-27');
    assert.equal(res.status, 0, res.stderr);
    assert.match(digest(s, '2026-10-27'), /## Feed health\n- github-lists: 0 new rows today, 2 of the last 2 runs had rows; check by hand/);
  } finally {
    s.cleanup();
  }
});

test('W-027 an unreadable health history becomes one digest line and exit 0', () => {
  const s = setup();
  try {
    mkdirSync(join(s.data, 'feed-health.tsv'));
    const res = run(s.up, '2026-10-27');
    assert.equal(res.status, 0, res.stderr);
    assert.match(digest(s, '2026-10-27'), /## Feed health\n- not checked \(/);
  } finally {
    s.cleanup();
  }
});
