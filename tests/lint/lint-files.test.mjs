import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintFiles } from '../../scripts/lint-files.mjs';

const cli = fileURLToPath(new URL('../../scripts/lint-files.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const EM = String.fromCharCode(0x2014);
const LQ = String.fromCharCode(0x201c);
const RQ = String.fromCharCode(0x201d);
const LS = String.fromCharCode(0x2018);
const RS = String.fromCharCode(0x2019);
const OSA = String.fromCharCode(111, 115, 97, 115, 99, 114, 105, 112, 116);

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'pack-files-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev');
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  git('add', '-A');
  return root;
}
const run = (root) => spawnSync(process.execPath, [cli, '--root', root], { encoding: 'utf8' });

// M-001-S16
test('M-001-S16 banned extensions are reported with file and rule', async () => {
  const exts = ['sh', 'bash', 'zsh', 'ps1', 'py', 'bat', 'cmd', 'command'];
  const files = {};
  for (const e of exts) files[`tools/run.${e}`] = 'x\n';
  const root = makeRepo(files);
  try {
    const findings = await lintFiles(root);
    for (const e of exts) {
      assert.ok(findings.some((f) => String(f.file).endsWith(`run.${e}`) && f.rule === 'shell-or-python'), e);
    }
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /run\.sh/);
    assert.match(r.stdout, /shell-or-python/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-001-S16
test('M-001-S16 macOS-only tool name is a finding outside tests/ only', async () => {
  const root = makeRepo({
    'lib/a.mjs': `const t = '${OSA}';\nexport default t;\n`,
    'tests/b.test.mjs': `const t = '${OSA}';\nexport default t;\n`,
  });
  try {
    const findings = await lintFiles(root);
    assert.ok(findings.some((f) => String(f.file).endsWith('lib/a.mjs') && f.rule === 'osascript'));
    assert.ok(!findings.some((f) => String(f.file).includes('tests/b.test.mjs')));
    assert.equal(run(root).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-001-S17
test('M-001-S17 em dash and curly quotes are reported with file and line', async () => {
  const root = makeRepo({
    'docs/a.md': `fine\nbad ${EM} dash\n`,
    'config/b.yml': `k: ${LQ}v${RQ}\n`,
    'lib/c.mjs': `// ok\n// ok\nconst s = '${LS}x${RS}';\nexport default s;\n`,
    'p/d.json': `{"k": "${EM}"}\n`,
    'p/e.yaml': `k: ${RS}\n`,
    'lib/f.js': `${EM}\n`,
  });
  try {
    const findings = await lintFiles(root);
    const want = { 'docs/a.md': 2, 'config/b.yml': 1, 'lib/c.mjs': 3, 'p/d.json': 1, 'p/e.yaml': 1, 'lib/f.js': 1 };
    for (const [file, line] of Object.entries(want)) {
      assert.ok(findings.some((f) => f.file === file && f.line === line && f.rule === 'typography'), `${file}:${line}`);
    }
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /docs\/a\.md:2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-001-S17
test('M-001-S17 clean tree exits 0', async () => {
  const root = makeRepo({ 'docs/a.md': 'plain text\n', 'lib/a.mjs': 'export default 1;\n' });
  try {
    assert.deepEqual(await lintFiles(root), []);
    assert.equal(run(root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shipped tree is clean', async () => {
  assert.deepEqual(await lintFiles(repoRoot), []);
});
