import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanPath, SYNTHETIC_MARKER } from '../../scripts/pii-lint.mjs';

const cli = fileURLToPath(new URL('../../scripts/pii-lint.mjs', import.meta.url));
const realEmail = ['someone', 'real-corp.io'].join('@');
const phone = ['(408)', '234', '5678'].join(' ').replace(') ', ') ').replace(' 234 ', ' 234-');
const blocked = String.fromCharCode(112, 97, 117, 108, 111, 115);

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'pack-pii-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'clean\n');
  return root;
}
const run = (root) => spawnSync(process.execPath, [cli, '--root', root], { encoding: 'utf8' });

test('scanners', () => {
  assert.ok(scanText('a.md', `mail ${realEmail}`).some((f) => f.rule === 'email'));
  assert.equal(scanText('a.md', 'mail dev@example.com').length, 0);
  assert.ok(scanText('a.md', `call ${phone}`).some((f) => f.rule === 'phone'));
  assert.equal(scanText('a.md', 'call (408) 555-0123').length, 0);
  assert.ok(scanText('a.md', `name ${blocked}`).some((f) => f.rule === 'blocked-token'));
  assert.ok(scanPath('data/pipeline.md').some((f) => f.rule === 'forbidden-path'));
  const resume = '# Experience\nx\n# Education\ny\n';
  assert.ok(scanText('tests/fixtures/r.md', resume).some((f) => f.rule === 'resume-shape'));
  assert.equal(scanText('tests/fixtures/r.md', `${SYNTHETIC_MARKER}\n${resume}`).length, 0);
});

// M-001-S12
test('M-001-S12 untracked file with a non-example email exits 1; clean tree exits 0', () => {
  const root = repo();
  try {
    assert.equal(run(root).status, 0);
    writeFileSync(join(root, 'fixture.txt'), `contact ${realEmail}\n`);
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /fixture\.txt:1 email/);
    rmSync(join(root, 'fixture.txt'));
    assert.equal(run(root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI exits 2 on unknown flag', () => {
  assert.equal(spawnSync(process.execPath, [cli, '--bogus'], { encoding: 'utf8' }).status, 2);
});
