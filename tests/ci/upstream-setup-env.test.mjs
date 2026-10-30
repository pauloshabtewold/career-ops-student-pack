import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setupUpstream } from '../../scripts/ci/upstream-setup.mjs';

// M-003-S4 normal: the env parameter reaches the npm install run, plus the Playwright flag
test('setupUpstream passes the given env plus PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 to npm install', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-env-'));
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  process.env.M003_LEAK_MARKER = 'leak';
  try {
    const pack = join(root, 'pack');
    mkdirSync(pack, { recursive: true });
    put('pack/compat.json', JSON.stringify({ upstream: { tag_prefix: 'v', max: '1.0.0' } }));
    put('pack/answers.json', '{}');
    put('pack/resume.md', '# Example Resume\n');
    const npmCliFile = join(root, 'fake-npm', 'npm-cli.js');
    put('fake-npm/npm-cli.js', '');
    const calls = [];
    const runner = (cmd, args, opts = {}) => {
      calls.push({ cmd, args, opts });
      return '{}';
    };
    setupUpstream({
      out: join(root, 'checkout'),
      version: '1.0.0',
      pack,
      answers: 'answers.json',
      resume: 'resume.md',
      runner,
      env: { STUDENT_PACK_TEST: '1', npm_execpath: npmCliFile },
    });
    const install = calls.find((c) => c.args.includes('install'));
    assert.ok(install, 'npm install was run');
    assert.equal(install.opts.env.STUDENT_PACK_TEST, '1');
    assert.equal(install.opts.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
    assert.equal(install.opts.env.M003_LEAK_MARKER, undefined);
    assert.equal(install.args[0], npmCliFile);
  } finally {
    delete process.env.M003_LEAK_MARKER;
    rmSync(root, { recursive: true, force: true });
  }
});
