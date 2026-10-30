// Assumed: install({ root, packRoot, dryRun, runner, nodeVersion, platform, skipNpm }) runs `npm ci --omit=dev` in packRoot
// and `npm install` in root through runner when root/node_modules is missing; on win32 the command is npm.cmd with
// opts.shell true. Each npm step is an action line (or a "skipped" line); a failing step raises InstallError naming the
// step and the manual command. The runner is a fake, so no real npm runs; the CLI test puts a fake npm first on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { InstallError, install } from '../../install.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE_VERSION = process.versions.node;
const isNpm = (c) => /^npm(\.cmd)?$/.test(c.cmd);

function fakeRunner(fail = () => false) {
  const calls = [];
  const runner = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    if (fail(cmd, args)) throw Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}`), { status: 1, stderr: 'npm ERR! sample failure' });
    return '';
  };
  return { runner, calls };
}

function withRoot(fn) {
  const up = createFakeUpstream();
  try {
    return fn(up);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
}

// M-002-S15
test('M-002-S15 a root without node_modules gets npm ci --omit=dev in the pack and npm install in the root', () =>
  withRoot((up) => {
    const { runner, calls } = fakeRunner();
    const res = install({ root: up.root, packRoot: PACK_ROOT, runner, nodeVersion: NODE_VERSION, platform: 'linux' });
    const npm = calls.filter(isNpm);
    const ci = npm.find((c) => c.args[0] === 'ci');
    const inst = npm.find((c) => c.args[0] === 'install');
    assert.deepEqual(ci.args, ['ci', '--omit=dev']);
    assert.equal(ci.opts.cwd, PACK_ROOT);
    assert.equal(ci.cmd, 'npm');
    assert.deepEqual(inst.args, ['install']);
    assert.equal(inst.opts.cwd, up.root);
    const text = res.actions.join('\n');
    assert.match(text, /npm ci --omit=dev/);
    assert.match(text, /npm install/);
  }));

// M-002-S15
test('M-002-S15 on win32 the runner gets npm.cmd with shell true', () =>
  withRoot((up) => {
    const { runner, calls } = fakeRunner();
    install({ root: up.root, packRoot: PACK_ROOT, runner, nodeVersion: NODE_VERSION, platform: 'win32' });
    const npm = calls.filter(isNpm);
    assert.equal(npm.length, 2);
    for (const c of npm) {
      assert.equal(c.cmd, 'npm.cmd');
      assert.equal(c.opts.shell, true);
    }
  }));

// M-002-S16
test('M-002-S16 an existing root node_modules skips the root npm step and says so', () =>
  withRoot((up) => {
    mkdirSync(join(up.root, 'node_modules'));
    const { runner, calls } = fakeRunner();
    const res = install({ root: up.root, packRoot: PACK_ROOT, runner, nodeVersion: NODE_VERSION, platform: 'linux' });
    assert.equal(calls.filter(isNpm).some((c) => c.args[0] === 'install'), false);
    assert.match(res.actions.join('\n'), /skipped[^\n]*npm install|npm install[^\n]*skipped/i);
  }));

// M-002-S16
test('M-002-S16 --dry-run runs no npm step and lists them', () =>
  withRoot((up) => {
    const { runner, calls } = fakeRunner();
    const res = install({ root: up.root, packRoot: PACK_ROOT, dryRun: true, runner, nodeVersion: NODE_VERSION, platform: 'linux' });
    assert.equal(calls.filter(isNpm).length, 0);
    const text = res.actions.join('\n');
    assert.match(text, /npm ci --omit=dev/);
    assert.match(text, /npm install/);
  }));

// M-002-S17
test('M-002-S17 a failing npm step raises InstallError naming the step and the command to run by hand', () =>
  withRoot((up) => {
    const { runner } = fakeRunner((cmd, args) => args[0] === 'ci');
    assert.throws(
      () => install({ root: up.root, packRoot: PACK_ROOT, runner, nodeVersion: NODE_VERSION, platform: 'linux' }),
      (err) => err instanceof InstallError && /npm ci --omit=dev/.test(err.message),
    );
    const second = fakeRunner((cmd, args) => args[0] === 'install');
    assert.throws(
      () => install({ root: up.root, packRoot: PACK_ROOT, runner: second.runner, nodeVersion: NODE_VERSION, platform: 'linux' }),
      (err) => err instanceof InstallError && /npm install/.test(err.message),
    );
  }));

// M-002-S17
test('M-002-S17 install.mjs exits 1 with the failed step and manual command when npm fails', () => {
  const up = createFakeUpstream();
  const bin = mkdtempSync(join(tmpdir(), 'fake-npm-'));
  try {
    writeFileSync(join(bin, 'npm'), "#!/usr/bin/env node\nconsole.error('npm ERR! sample failure');\nprocess.exit(1);\n");
    chmodSync(join(bin, 'npm'), 0o755);
    // install.mjs starts npm.cmd through a shell on Windows, which never runs the extensionless shim above.
    writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\necho npm ERR! sample failure 1>&2\r\nexit /b 1\r\n');
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'install.mjs'), '--root', up.root, '--yes'], {
      cwd: up.root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /npm ci --omit=dev/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(up.root, { recursive: true, force: true });
  }
});
