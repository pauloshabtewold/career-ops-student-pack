// Offline end-to-end tier: one synthetic student through the README's whole lifecycle on a fake upstream, in the order
// a student runs it (install, interview answers, session start, schedule dry run, update, uninstall). The live parts
// (model interview, board scans, a real launchd fire) stay with the W-015 manual walkthrough; this keeps the scripted
// chain from regressing between waves. No network, no real schedule, no real checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePack, put } from '../install/_pack-repo.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const fixture = (rel) => readFileSync(join(PACK_ROOT, 'tests', 'fixtures', rel), 'utf8');

// W-015-E1
test('W-015-E1 install, answers, session start, schedule, update and uninstall chain cleanly for the cs fixture', () => {
  const p = makePack({});
  try {
    const install = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(install.code, 0, install.stdout + install.stderr);

    const before = p.run('scripts/session-start.mjs');
    assert.ok(before.lines.some((l) => l.startsWith('INTERVIEW:')), `fresh install asks for the interview:\n${before.stdout}`);

    put(p.root, 'cv.md', fixture('resumes/cs.md'));
    put(p.root, 'data/interview-answers.json', fixture('answers/cs.json'));
    const apply = p.run('interview/apply-answers.mjs', ['data/interview-answers.json', '--today', '2026-10-30']);
    assert.equal(apply.code, 0, apply.stdout + apply.stderr);
    assert.doesNotMatch(apply.stdout, /cannot be written as an upstream title term/, 'every software-cs title rule reaches upstream');
    assert.ok(existsSync(join(p.root, 'config', 'student.yml')));

    const after = p.run('scripts/session-start.mjs');
    assert.ok(!after.lines.some((l) => l.startsWith('INTERVIEW:')), `answers applied, no interview prompt:\n${after.stdout}`);

    const sched = p.run('scripts/schedule.mjs', ['install', '--dry-run']);
    assert.equal(sched.code, 0, sched.stdout + sched.stderr);
    assert.match(sched.stdout, /scheduled\.mjs/);

    const overrideBefore = readFileSync(join(p.root, 'AGENTS.override.md'), 'utf8');
    const update = p.run('update.mjs', ['--offline']);
    assert.equal(update.code, 0, update.stdout + update.stderr);
    assert.equal(readFileSync(join(p.root, 'AGENTS.override.md'), 'utf8'), overrideBefore, 'update keeps the generated override');
    assert.ok(update.lines.some((l) => /^pack: up to date/.test(l)), update.stdout);

    const un = p.run('uninstall.mjs', ['--skip-schedule']);
    assert.equal(un.code, 0, un.stdout + un.stderr);
    assert.equal(existsSync(join(p.root, 'CLAUDE.local.md')), false);
    assert.equal(existsSync(join(p.root, 'AGENTS.override.md')), false);
    assert.equal(existsSync(join(p.root, 'plugins.local', 'github-lists')), true, 'the fake upstream remove is a stub; the call is what counts');
    assert.ok(p.upstreamCalls().some((c) => c.cli === 'plugins.mjs' && c.argv.join(' ') === 'remove github-lists'));
    for (const f of ['cv.md', 'config/student.yml', 'data/interview-answers.json']) assert.ok(existsSync(join(p.root, f)), `${f} kept`);
    const exclude = readFileSync(join(p.root, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/);
    assert.deepEqual(exclude.filter((l) => ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', 'config/student.yml'].includes(l)), ['config/student.yml']);
  } finally {
    p.cleanup();
  }
});
