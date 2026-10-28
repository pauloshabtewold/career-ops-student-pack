import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../../lib/args.mjs';

const lintFiles = fileURLToPath(new URL('../../scripts/lint-files.mjs', import.meta.url));
const spec = { flags: { limit: 'int', name: 'string', verbose: 'boolean', since: 'date' } };

test('typed values, command and positionals', () => {
  const r = parseArgs(['run', 'one', '--limit', '5', '--name', 'x', '--verbose', '--since', '2026-02-28', '--dry-run', '--json', '--today', '2026-03-01'], spec);
  assert.equal(r.command, 'run');
  assert.deepEqual(r.positionals, ['one']);
  assert.equal(r.flags.limit, 5);
  assert.equal(r.flags.name, 'x');
  assert.equal(r.flags.verbose, true);
  assert.equal(r.flags.since, '2026-02-28');
  assert.equal(r.flags.today, '2026-03-01');
  assert.equal(r.flags['dry-run'] ?? r.flags.dryRun, true);
  assert.equal(r.flags.json, true);
});

// M-001-S13
test('M-001-S13 unknown flag and malformed dates throw UsageError', () => {
  assert.throws(() => parseArgs(['--nope'], spec), UsageError);
  assert.throws(() => parseArgs(['--today', '2026-1-5'], spec), UsageError);
  assert.throws(() => parseArgs(['--today', 'tomorrow'], spec), UsageError);
  assert.throws(() => parseArgs(['--today', '2026-02-30'], spec), UsageError);
  assert.throws(() => parseArgs(['--limit', 'many'], spec), UsageError);
});

// M-001-S13
test('M-001-S13 CLI exits 2 with a one-line usage message', () => {
  for (const argv of [['--nope'], ['--today', '2026-13-45'], ['--today', 'abc']]) {
    const r = spawnSync(process.execPath, [lintFiles, ...argv], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    const msg = (r.stderr + r.stdout).trim();
    assert.ok(msg.length > 0);
    assert.equal(msg.split('\n').length, 1);
  }
});
