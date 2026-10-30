// Error branches of scripts/daily-triage.mjs that the main triage tests do not reach: no claude on PATH, a failing
// apply-triage child, and the main() catch. Each ends with exit 0 (or a normal return) and pipeline.md unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { PACK_ROOT, TODAY, script } from '../helpers/script-harness.mjs';
import { PLUS, args, jobUrl, makeRunner, makeTriageRoot, untriaged, verdict, digestFile } from '../helpers/triage-harness.mjs';

function runCli(r, env) {
  const argv = [script('daily-triage'), '--root', r.root, '--data-dir', r.data, '--today', TODAY];
  const out = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000, env });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

test('daily-triage with no claude on PATH and no --claude exits 0, notes it in the digest and leaves pipeline.md unchanged', () => {
  const r = makeTriageRoot({ pending: untriaged(2) });
  const emptyBin = mkdtempSync(join(tmpdir(), 'pack-empty-bin-'));
  try {
    const before = r.read('data/pipeline.md');
    const res = runCli(r, { ...process.env, PATH: emptyBin });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /claude was not found/);
  } finally {
    rmSync(emptyBin, { recursive: true, force: true });
    r.cleanup();
  }
});

test('a failing apply-triage child exits normally with a digest note and leaves pipeline.md unchanged', async () => {
  const r = makeTriageRoot({ config: PLUS, pending: untriaged(2) });
  try {
    const before = r.read('data/pipeline.md');
    const { runner: base } = makeRunner(r, { claude: () => verdict('PASS', jobUrl(1), '4.2') });
    const runner = (cmd, argv, opts) => {
      if (cmd === process.execPath && basename(argv[0]) === 'apply-triage.mjs') {
        throw Object.assign(new Error('Command failed: apply-triage'), { status: 1, stderr: 'pipeline locked\nsecond line' });
      }
      return base(cmd, argv, opts);
    };
    const res = await dailyTriage({ ...args(r), runner });
    assert.equal(res.ran, false);
    assert.equal(r.read('data/pipeline.md'), before);
    const digest = r.read(digestFile(r));
    assert.match(digest, /could not apply its verdicts: pipeline locked/);
    assert.doesNotMatch(digest, /second line/);
  } finally {
    r.cleanup();
  }
});

test('daily-triage main() catches an unreadable config, prints a stopped line, exits 0 and leaves pipeline.md unchanged', () => {
  const r = makeTriageRoot({ config: 'automation: [unclosed\n', pending: untriaged(2) });
  try {
    const before = r.read('data/pipeline.md');
    const res = runCli(r, process.env);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /daily-triage: stopped \(/);
    assert.equal(r.read('data/pipeline.md'), before);
  } finally {
    r.cleanup();
  }
});
