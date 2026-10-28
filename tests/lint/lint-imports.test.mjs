import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintImports } from '../../scripts/lint-imports.mjs';

const cli = fileURLToPath(new URL('../../scripts/lint-imports.mjs', import.meta.url));

// Pack root is a nested dir so a ../ escape resolves to a real sibling location.
function makePack(files) {
  const outer = mkdtempSync(join(tmpdir(), 'pack-imp-'));
  const root = join(outer, 'pack');
  mkdirSync(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return { outer, root };
}
const run = (root) => spawnSync(process.execPath, [cli, '--root', root], { encoding: 'utf8' });

// M-001-S10
test('M-001-S10 escaping relative and bare imports are reported with file and line, exit 1', async () => {
  const { outer, root } = makePack({
    'lib/a.mjs': "import x from '../../outside.mjs';\nexport default x;\n",
    'lib/b.mjs': "\nimport lodash from 'lodash';\nexport default lodash;\n",
  });
  try {
    const findings = await lintImports(root);
    const a = findings.find((f) => String(f.file).endsWith('a.mjs'));
    const b = findings.find((f) => String(f.file).endsWith('b.mjs'));
    assert.ok(a, 'escaping import reported');
    assert.equal(a.line, 1);
    assert.ok(b, 'bare import reported');
    assert.equal(b.line, 2);
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /a\.mjs:1/);
    assert.match(r.stdout, /b\.mjs:2/);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('absolute, file URL, require and non-literal dynamic imports are findings', async () => {
  const { outer, root } = makePack({
    'lib/abs.mjs': "import x from '/etc/hosts';\n",
    'lib/url.mjs': "import x from 'file:///tmp/x.mjs';\n",
    'lib/req.js': "const y = require('left-pad');\n",
    'lib/dyn.mjs': "const n = 'a';\nawait import(n);\n",
  });
  try {
    const findings = await lintImports(root);
    for (const name of ['abs.mjs', 'url.mjs', 'req.js', 'dyn.mjs']) {
      assert.ok(findings.some((f) => String(f.file).endsWith(name)), `${name} reported`);
    }
    assert.equal(findings.find((f) => String(f.file).endsWith('dyn.mjs')).line, 2);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('plugin files may not import outside their own plugin directory', async () => {
  const { outer, root } = makePack({
    'lib/shared.mjs': 'export const v = 1;\n',
    'plugins/demo/index.mjs': "import { v } from '../../lib/shared.mjs';\nexport default v;\n",
  });
  try {
    const findings = await lintImports(root);
    assert.ok(findings.some((f) => String(f.file).includes('plugins') && f.line === 1));
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

// M-001-S11
test('M-001-S11 node builtins, js-yaml and pack-internal imports are accepted', async () => {
  const { outer, root } = makePack({
    'lib/shared.mjs': 'export const v = 1;\n',
    'lib/ok.mjs': [
      "import { readFileSync } from 'node:fs';",
      "import yaml from 'js-yaml';",
      "import { v } from './shared.mjs';",
      "export { v as w } from './shared.mjs';",
      "const m = await import('node:path');",
      'export default [readFileSync, yaml, v, m];',
      '',
    ].join('\n'),
    'tests/fixtures/skipped.mjs': "import z from 'not-allowed-but-fixture';\n",
  });
  try {
    assert.deepEqual(await lintImports(root), []);
    assert.equal(run(root).status, 0);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('CLI exits 2 on unknown flag', () => {
  assert.equal(spawnSync(process.execPath, [cli, '--bogus'], { encoding: 'utf8' }).status, 2);
});
