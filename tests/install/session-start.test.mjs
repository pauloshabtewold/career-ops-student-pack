// Assumed: scripts/session-start.mjs is a CLI run as `node student/scripts/session-start.mjs --root <checkout>`;
// it prints at most 6 lines to stdout, including the exact interview trigger line when config/student.yml is missing
// or onboarding.complete is false, one line naming the restored file when it restores budget.mjs, and one line
// with the outreach and handshake switch states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makePack, checkJson, put } from './_pack-repo.mjs';

const TRIGGER = 'INTERVIEW: run student/interview/interview.md before anything else';
const SCRIPT = 'scripts/session-start.mjs';

async function withPack(fn) {
  const p = makePack();
  p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}

// M-005-S13
test('M-005-S13 a missing student.yml prints the interview trigger', () =>
  withPack((p) => {
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(r.lines.includes(TRIGGER), r.lines.join('\n'));
    assert.ok(r.lines.length <= 6, r.lines.join('\n'));
  }));

// M-005-S13
test('M-005-S13 onboarding.complete false prints the interview trigger', () =>
  withPack((p) => {
    put(p.root, 'config/student.yml', 'timezone: America/Chicago\nonboarding:\n  complete: false\n');
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(r.lines.includes(TRIGGER), r.lines.join('\n'));
  }));

// M-005-S13
test('M-005-S13 a completed onboarding prints no trigger and one switch line', () =>
  withPack((p) => {
    put(p.root, 'config/student.yml', 'timezone: America/Chicago\nonboarding:\n  complete: true\nswitches:\n  outreach: drafts\n  handshake: "off"\n');
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(!r.lines.includes(TRIGGER), r.lines.join('\n'));
    const sw = r.lines.filter((l) => /outreach/i.test(l) && /handshake/i.test(l));
    assert.equal(sw.length, 1, r.lines.join('\n'));
    assert.match(sw[0], /drafts/);
    assert.match(sw[0], /off/);
    assert.ok(r.lines.length <= 6, r.lines.join('\n'));
  }));

// M-005-S11
test('M-005-S11 session start restores an edited budget.mjs and prints one line', () =>
  withPack((p) => {
    const before = p.read('scripts/budget.mjs');
    appendFileSync(p.file('scripts/budget.mjs'), '\n// edited locally\n');
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(p.read('scripts/budget.mjs'), before);
    assert.equal(r.lines.filter((l) => /budget\.mjs/.test(l) && /restor/i.test(l)).length, 1, r.lines.join('\n'));
    assert.ok(r.lines.length <= 6, r.lines.join('\n'));
  }));

// M-005-S12
test('M-005-S12 session start restores both files after a hash-consistent edit', () =>
  withPack((p) => {
    const [budget, compat] = [p.read('scripts/budget.mjs'), p.read('compat.json')];
    const raised = budget.replace('connect_per_day: down(20,', 'connect_per_day: down(999,');
    assert.notEqual(raised, budget);
    writeFileSync(p.file('scripts/budget.mjs'), raised);
    const c = JSON.parse(compat);
    c.budgetSha256 = createHash('sha256').update(raised).digest('hex');
    writeFileSync(p.file('compat.json'), `${JSON.stringify(c, null, 2)}\n`);
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(p.read('scripts/budget.mjs'), budget);
    assert.equal(p.read('compat.json'), compat);
    assert.equal(readFileSync(p.file('compat.json'), 'utf8'), compat);
  }));
