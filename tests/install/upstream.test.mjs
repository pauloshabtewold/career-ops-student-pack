// Assumed: lib/semver.mjs exports compare(a, b) -> negative|0|positive, inRange(v, {min, max}) (inclusive), parseTag(tag) -> 'X.Y.Z'.
// lib/upstream.mjs exports createUpstream({ root, runner }); runner(file, args, options) -> stdout string, mirroring
// execFileSync(process.execPath, [<root>/<cli>.mjs, ...args], { cwd: root, ... }). Methods may be sync or async.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { compare, inRange, parseTag } from '../../lib/semver.mjs';
import { createUpstream } from '../../lib/upstream.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';

// M-005-S4
test('M-005-S4 compare orders X.Y.Z numerically', () => {
  assert.ok(compare('1.10.0', '1.9.0') > 0);
  assert.ok(compare('1.38.0', '1.38.1') < 0);
  assert.equal(compare('1.38.0', '1.38.0'), 0);
  assert.ok(compare('2.0.0', '1.99.99') > 0);
});

// M-005-S4
test('M-005-S4 inRange is inclusive at both ends', () => {
  const range = { min: '1.38.0', max: '1.38.0' };
  assert.equal(inRange('1.38.0', range), true);
  assert.equal(inRange('1.38.1', range), false);
  assert.equal(inRange('1.37.9', range), false);
  assert.equal(inRange('1.40.0', { min: '1.38.0', max: '1.42.0' }), true);
});

// M-005-S7
test('M-005-S7 parseTag strips the upstream tag prefix', () => {
  assert.equal(parseTag('career-ops-v1.38.0'), '1.38.0');
});

function recording(stdout = '{}') {
  const calls = [];
  const runner = (file, args, options) => {
    calls.push({ file, args, options });
    return stdout;
  };
  return { calls, runner };
}
const tail = (call) => call.args.slice(1);

// M-005-S4
test('M-005-S4 the upstream wrapper builds the update-system argv and parses the check line', async () => {
  const up = createFakeUpstream();
  const rec = recording('{"status":"update-available","local":"1.38.0","remote":"1.39.0"}\n');
  const u = createUpstream({ root: up.root, runner: rec.runner });
  assert.deepEqual(await u.updateCheck(), { status: 'update-available', local: '1.38.0', remote: '1.39.0' });
  await u.updateApply();
  await u.updateDismiss('1.39.0');
  assert.equal(rec.calls[0].file, process.execPath);
  assert.equal(basename(rec.calls[0].args[0]), 'update-system.mjs');
  assert.deepEqual(rec.calls.map(tail), [['check'], ['apply', '--confirm'], ['dismiss', '--version', '1.39.0']]);
  assert.equal(rec.calls[0].options.cwd, up.root);
});

// M-005-S9
test('M-005-S9 the upstream wrapper builds the plugins.mjs trust argv', async () => {
  const up = createFakeUpstream();
  const rec = recording('');
  const u = createUpstream({ root: up.root, runner: rec.runner });
  await u.pluginsTrust('github-lists');
  assert.equal(basename(rec.calls[0].args[0]), 'plugins.mjs');
  assert.deepEqual(tail(rec.calls[0]), ['trust', 'github-lists']);
});

// M-005-S4
test('M-005-S4 version() reads the checkout package.json and doctor() parses --json output', async () => {
  const up = createFakeUpstream({ version: '1.38.0' });
  const rec = recording('{"ok":true}');
  const u = createUpstream({ root: up.root, runner: rec.runner });
  assert.equal(await u.version(), '1.38.0');
  assert.deepEqual(await u.doctor(), { ok: true });
  assert.equal(basename(rec.calls[0].args[0]), 'doctor.mjs');
  assert.ok(tail(rec.calls[0]).includes('--json'));
});

// M-005-S4
test('M-005-S4 the default runner executes the checkout CLI as a child process', async () => {
  const up = createFakeUpstream();
  up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0"}\n');
  const u = createUpstream({ root: up.root });
  assert.equal((await u.updateCheck()).status, 'up-to-date');
  assert.deepEqual(up.calls().map((c) => [c.cli, c.argv]), [['update-system.mjs', ['check']]]);
});
