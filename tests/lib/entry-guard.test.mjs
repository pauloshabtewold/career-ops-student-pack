// Shared entry guard: isMain(import.meta.url) decides whether a pack CLI file was started directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from '../../lib/args.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pack-guard-')));
  const file = join(dir, 'mod.mjs');
  writeFileSync(file, 'export {};\n');
  const other = join(dir, 'other.mjs');
  writeFileSync(other, 'export {};\n');
  return { dir, file, other, url: pathToFileURL(file).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('M-001-S3 isMain is true for the module absolute path and for a path relative to cwd', () => {
  const s = scratch();
  const before = process.cwd();
  try {
    assert.equal(isMain(s.url, s.file), true);
    process.chdir(s.dir);
    assert.equal(isMain(s.url, 'mod.mjs'), true);
    assert.equal(isMain(s.url, relative(process.cwd(), s.file)), true);
  } finally {
    process.chdir(before);
    s.cleanup();
  }
});

test('M-001-S7 isMain is true when argv1 reaches the module through a directory link', () => {
  const s = scratch();
  const real = join(s.dir, 'real');
  const link = join(s.dir, 'link');
  try {
    mkdirSync(real);
    writeFileSync(join(real, 'mod.mjs'), 'export {};\n');
    symlinkSync(real, link, 'junction');
    assert.equal(isMain(pathToFileURL(join(real, 'mod.mjs')).href, join(link, 'mod.mjs')), true);
    assert.equal(isMain(pathToFileURL(join(link, 'mod.mjs')).href, join(real, 'mod.mjs')), true);
  } finally {
    s.cleanup();
  }
});

test('M-001-S10 isMain returns false without throwing for an empty argv1, a file: URL argv1 and missing paths', () => {
  const s = scratch();
  try {
    assert.equal(isMain(s.url, ''), false);
    assert.equal(isMain(s.url, s.url), false);
    assert.equal(isMain(s.url, join(s.dir, 'missing.mjs')), false);
    assert.equal(isMain(pathToFileURL(join(s.dir, 'missing.mjs')).href, s.file), false);
  } finally {
    s.cleanup();
  }
});

test('M-001-S11 isMain returns false for a different existing file', () => {
  const s = scratch();
  try {
    assert.equal(isMain(s.url, s.other), false);
  } finally {
    s.cleanup();
  }
});

test('M-001-S4 pii-lint started by a relative path (through a pack-root link) runs main and prints its result line', () => {
  const s = scratch();
  try {
    execFileSync('git', ['init', '-q'], { cwd: s.dir });
    writeFileSync(join(s.dir, 'notes.txt'), 'Example notes.\n');
    // The pack root is reached through a directory link, so only a realpath comparison recognizes the entry file.
    const packLink = join(s.dir, 'pack-link');
    symlinkSync(PACK_ROOT, packLink, 'junction');
    const out = spawnSync(process.execPath, [join('pack-link', 'scripts', 'pii-lint.mjs'), '--root', s.dir], { cwd: s.dir, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^pii-lint: /m);
  } finally {
    s.cleanup();
  }
});

const ENTRY_FILES = [
  'update.mjs',
  'install.mjs',
  'tools/goal-check.mjs',
  'tools/parity.mjs',
  'interview/coverage.mjs',
  'interview/resume-text.mjs',
  'interview/apply-answers.mjs',
  'interview/detect-field.mjs',
  'scripts/preset-portals.mjs',
  'scripts/handshake-import.mjs',
  'scripts/session-start.mjs',
  'scripts/lint-imports.mjs',
  'scripts/prefilter.mjs',
  'scripts/discover-github-lists.mjs',
  'scripts/apply-triage.mjs',
  'scripts/schedule.mjs',
  'scripts/rank-queue.mjs',
  'scripts/pii-lint.mjs',
  'scripts/lint-files.mjs',
  'scripts/merge-post.mjs',
  'scripts/inbox.mjs',
  'scripts/fail-audit.mjs',
  'scripts/scheduled.mjs',
  'scripts/check-safety-tag.mjs',
  'scripts/cycle.mjs',
  'scripts/daily-triage.mjs',
  'scripts/check-resume.mjs',
  'scripts/compat-hash.mjs',
  'scripts/budget.mjs',
  'scripts/check-plugin-versions.mjs',
  'scripts/first-run.mjs',
  'scripts/liveness-sweep.mjs',
  'scripts/daily.mjs',
  'scripts/pilot-report.mjs',
  'scripts/ci/release.mjs',
  'scripts/ci/mark-unmaintained.mjs',
  'scripts/ci/assert-doctor.mjs',
  'scripts/ci/audit-issues.mjs',
  'scripts/ci/upstream-setup.mjs',
  'scripts/ci/bump-compat.mjs',
];

const SKIP_DIRS = new Set(['tests', 'node_modules', '.git', 'plugins', '.claude']);
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (e.name.endsWith('.mjs')) out.push(join(dir, e.name));
  }
  return out;
}

test('M-001-S6 no inline process.argv[1] guard is left and all 40 entry files use isMain(import.meta.url)', () => {
  const offenders = walk(PACK_ROOT).filter((f) => /process\.argv\[1\]\s*&&/.test(readFileSync(f, 'utf8'))).map((f) => relative(PACK_ROOT, f));
  assert.deepEqual(offenders, []);
  assert.equal(ENTRY_FILES.length, 40);
  const missing = ENTRY_FILES.filter((f) => !/\bif\s*\(\s*isMain\(import\.meta\.url\)\s*\)/.test(readFileSync(join(PACK_ROOT, f), 'utf8')));
  assert.deepEqual(missing, []);
});

test('M-001-S12 compat-hash --check exits 0 for the shipped budget.mjs and compat.json', () => {
  const out = spawnSync(process.execPath, [join('scripts', 'compat-hash.mjs'), '--check'], { cwd: PACK_ROOT, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});
