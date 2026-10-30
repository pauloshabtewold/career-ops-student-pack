// Assumed output contract (spec: "print a counts-only table: row, deciding check, verdict, counts"): stdout and the
// --report file carry a markdown table whose data rows have the cells row, deciding check, verdict, counts, one row per
// design-goal row (10), verdict exactly "met" or "not met". Per-fixture top-list and new-grad counts appear on a line
// that names the fixture. All inputs are synthetic and the fake upstream records calls; no network, no real checkout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanText } from '../../scripts/pii-lint.mjs';
import { SETS, cleanupAll, copyPack, isVerdict, run, runAsync, setup, tableRows, writeFile } from './_harness.mjs';

after(cleanupAll);

let shared;
function sharedRun() {
  if (!shared) {
    const s = setup();
    shared = { s, r: run(s) };
  }
  return shared;
}

const designRows = (text) => tableRows(text).filter((c) => c.length >= 4 && isVerdict(c[2]));
const countFor = (text, set, what) => {
  const m = new RegExp(`\\b${set}\\b[^\\n]*?${what}[^\\d\\n]*?(\\d+)`, 'i').exec(text);
  return m ? Number(m[1]) : null;
};

// M-004-S1
test('M-004-S1 goal-check over the 5 fixtures prints one met verdict per design-goal row and exits 0', () => {
  const { s, r } = sharedRun();
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const rows = designRows(r.stdout);
  assert.equal(rows.length, 10, r.stdout);
  for (const c of rows) assert.equal(c[2], 'met', c.join(' | '));
  assert.equal(existsSync(s.scratch), false, 'scratch dir removed');
});

// M-004-S2
test('M-004-S2 every fixture has a top list of at least 1 and the internship-only fixtures list no new-grad row', () => {
  const { r } = sharedRun();
  assert.ok(r.reportText.length > 0, 'report written');
  for (const set of SETS) {
    const top = countFor(r.reportText, set, 'top');
    assert.ok(top !== null && top >= 1, `${set} top-list count: ${top}`);
  }
  for (const set of ['cs', 'finance']) assert.equal(countFor(r.reportText, set, 'new-?\\s?grad'), 0, `${set} new-grad rows`);
});

// M-004-S3
test('M-004-S3 a fixture whose apply-answers step fails marks affected rows not met naming it, exits 1 and removes scratch', () => {
  const pack = copyPack();
  writeFile(pack, 'tests/fixtures/answers/mis.json', '{ this is not json');
  const s = setup({ pack });
  const r = run(s);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const bad = designRows(r.stdout).filter((c) => c[2] === 'not met');
  assert.ok(bad.length >= 1, r.stdout);
  assert.ok(bad.every((c) => /\bmis\b/.test(c.join(' '))), `every not met row names the fixture: ${r.stdout}`);
  assert.equal(existsSync(s.scratch), false, 'scratch dir removed');
});

// M-004-S4
// Windows has no SIGINT delivery to a child process: kill('SIGINT') terminates it outright, so no handler can run.
test('M-004-S4 SIGINT during a run removes the scratch dir and exits 130', { skip: process.platform === 'win32' && 'no SIGINT delivery on Windows' }, async () => {
  const s = setup();
  const { child, done } = runAsync(s);
  const deadline = Date.now() + 60000;
  while (!existsSync(s.scratch) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 5));
  assert.ok(existsSync(s.scratch), 'scratch dir created before the signal');
  child.kill('SIGINT');
  const { code, signal } = await done;
  assert.equal(signal, null, 'handled, not killed by the signal');
  assert.equal(code, 130);
  assert.equal(existsSync(s.scratch), false, 'scratch dir removed');
});

// M-004-S5
test('M-004-S5 the goal-check report holds counts and verdicts only and passes the pii scan', () => {
  const { r } = sharedRun();
  assert.ok(r.reportText.length > 0, 'report written');
  assert.deepEqual(scanText('docs/goal-check.md', r.reportText), []);
  for (const text of [r.reportText, r.stdout]) {
    assert.ok(!/https?:\/\//i.test(text), 'no URL');
    assert.ok(!/example\.(com|org|net|edu)/i.test(text), 'no example domain');
    assert.ok(!/Example (Robotics|Capital|Motors|Systems|Health)/.test(text), 'no company token');
    assert.ok(!/@/.test(text), 'no address');
  }
});

// M-004-S11
test('M-004-S11 an empty staging feed gives top-list count 0, row 6 not met naming the fixture, and exit 1', () => {
  const pack = copyPack();
  writeFileSync(join(pack, 'tests', 'fixtures', 'goal-check', 'nursing.staging.md'), '');
  const s = setup({ pack });
  const r = run(s);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(countFor(r.reportText, 'nursing', 'top'), 0, r.reportText);
  const row6 = designRows(r.stdout).find((c) => /First run shows top-10/i.test(c[0]));
  assert.ok(row6, r.stdout);
  assert.equal(row6[2], 'not met');
  assert.match(row6.join(' '), /\bnursing\b/);
  assert.equal(existsSync(s.scratch), false, 'scratch dir removed');
});

// M-004-S12
test('M-004-S12 the report names the deciding check for each row and labels only Tailored materials and Daily schedule PROXY', () => {
  const { r } = sharedRun();
  const rows = designRows(r.reportText);
  assert.equal(rows.length, 10, r.reportText);
  for (const c of rows) assert.ok(c[1].length >= 3, `deciding check named: ${c.join(' | ')}`);
  const proxy = rows.filter((c) => /PROXY/.test(c.join(' ')));
  assert.equal(proxy.length, 2, proxy.map((c) => c[0]).join(','));
  assert.ok(proxy.some((c) => /Tailored materials/i.test(c[0])));
  assert.ok(proxy.some((c) => /Daily schedule/i.test(c[0])));
});
