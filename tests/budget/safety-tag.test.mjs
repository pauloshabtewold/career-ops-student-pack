import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSafetyDiff } from '../../lib/safety-diff.mjs';
import * as checker from '../../scripts/check-safety-tag.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

// The fixture mirrors scripts/budget.mjs: entry helpers, a frozen CEILINGS block of one entry per line, then logic.
// "logic" is plain code after the block, so a test can change code that the safety gate must not let through.
const HELPERS = `const entry = (value, unit, tighten, period) => ({ value, unit, tighten, period });
const down = (value, unit, period) => entry(value, unit, 'down', period);
const up = (value, unit, period) => entry(value, unit, 'up', period);
`;
const wrapBudget = (body, logic = 'export const looser = true;') => `${HELPERS}export const CEILINGS = Object.freeze({
${body}
});
${logic}
`;
const budgetSource = ({ connect = 20, nudgeMin = 5, extra = '', logic } = {}) =>
  wrapBudget(`  // Fixture
  connect_per_day: down(${connect}, 'count', 'day'),
  nudge_min_days: up(${nudgeMin}, 'days', 'day'),${extra}`, logic);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const compatJson = (budgetText, over = {}) =>
  `${JSON.stringify({ upstream: { min: '1.38.0', max: '1.38.0', tag_prefix: 'career-ops-v' }, budgetSha256: sha(budgetText), pipelineSections: ['Pending', 'Flagged', 'Skipped', 'Processed'], ...over }, null, 2)}\n`;
const defaultsYml = ({ automation = 'manual', outreach = 'on', handshake = 'off' } = {}) =>
  `automation: ${automation}\nswitches:\n  outreach: "${outreach}"\n  handshake: "${handshake}"\n`;

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Example Tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// Scratch pack repo: a synthetic budget.mjs, compat.json and defaults, plus copies of the checker and lib
// so the CLI resolves its pack root inside the scratch repo. Tag "base" holds the starting state.
function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'pack-safety-'));
  git(root, 'init', '-q');
  cpSync(join(PACK_ROOT, 'lib'), join(root, 'lib'), { recursive: true });
  cpSync(join(PACK_ROOT, 'scripts', 'check-safety-tag.mjs'), join(root, 'scripts', 'check-safety-tag.mjs'));
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(root, 'node_modules'));
  const budget = budgetSource();
  put(root, '.gitignore', 'node_modules/\n');
  put(root, 'scripts/budget.mjs', budget);
  put(root, 'compat.json', compatJson(budget));
  put(root, 'templates/student.defaults.yml', defaultsYml());
  put(root, 'AGENTS.student.md', 'Agent notes.\n');
  put(root, 'modes/notes.md', 'Mode notes.\n');
  put(root, 'README.md', 'Readme.\n');
  put(root, 'lib/extra.mjs', 'export const x = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'tag', 'base');
  return root;
}

async function verdict(root, mutate) {
  mutate(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'head');
  git(root, 'tag', 'head');
  const res = await checkSafetyDiff({ packRoot: root, base: 'base', head: 'head' });
  const violations = res.violations ?? (Array.isArray(res) ? res : []);
  const ok = res.ok ?? violations.length === 0;
  return { ok, violations, text: violations.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n') };
}

async function withRepo(fn) {
  const root = scratchRepo();
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// M-002-S23
test('M-002-S23 a tag that only lowers a max ceiling and updates budgetSha256 passes', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ connect: 15 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
    });
    assert.equal(v.ok, true, v.text);
    assert.equal(v.violations.length, 0);
  }));

test('M-002-S23 allowed files (agent notes, modes, defaults that stay off) may change alongside', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      put(root, 'AGENTS.student.md', 'Agent notes, revised.\n');
      put(root, 'modes/notes.md', 'Mode notes, revised.\n');
      put(root, 'modes/new-mode.md', 'A new mode.\n');
      put(root, 'templates/student.defaults.yml', defaultsYml({ automation: 'manual', outreach: 'drafts', handshake: 'off' }));
    });
    assert.equal(v.ok, true, v.text);
  }));

test('M-002-S23 raising a min ceiling passes', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ nudgeMin: 7 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
    });
    assert.equal(v.ok, true, v.text);
  }));

// M-002-S22
test('M-004-S13 M-002-S22 raising a max ceiling fails and names it', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ connect: 25 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
    });
    assert.equal(v.ok, false);
    assert.match(v.text, /connect_per_day/);
  }));

test('M-002-S22 lowering a min ceiling fails and names it', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ nudgeMin: 3 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
    });
    assert.equal(v.ok, false);
    assert.match(v.text, /nudge_min_days/);
  }));

test('M-002-S22 removing a ceiling entry fails', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = wrapBudget("  connect_per_day: down(20, 'count', 'day'),");
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
    });
    assert.equal(v.ok, false);
    assert.match(v.text, /nudge_min_days/);
  }));

test('M-002-S22 turning a default switch on fails', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'templates/student.defaults.yml', defaultsYml({ handshake: 'on' })));
    assert.equal(v.ok, false);
    assert.match(v.text, /handshake/);
  }));

test('M-002-S22 raising automation fails', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'templates/student.defaults.yml', defaultsYml({ automation: 'scheduled-discovery-plus-triage' })));
    assert.equal(v.ok, false);
    assert.match(v.text, /automation/);
  }));

test('M-004-S13 M-002-S22 touching a file outside the allowed set fails and names the file', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'lib/extra.mjs', 'export const x = 2;\n'));
    assert.equal(v.ok, false);
    assert.match(v.text, /lib\/extra\.mjs/);
  }));

test('M-002-S22 a rename from a disallowed path into an allowed one fails', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => git(root, 'mv', 'README.md', 'modes/readme.md'));
    assert.equal(v.ok, false);
    assert.match(v.text, /README\.md/);
  }));

test('M-002-S22 compat.json changes outside budgetSha256 fail', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const budget = readFileSync(join(root, 'scripts', 'budget.mjs'), 'utf8');
      put(root, 'compat.json', compatJson(budget, { upstream: { min: '1.38.0', max: '1.99.0', tag_prefix: 'career-ops-v' } }));
    });
    assert.equal(v.ok, false);
    assert.match(v.text, /compat\.json|upstream/);
  }));

test('M-002-S22 every violation is listed, one per distinct problem', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ connect: 25, nudgeMin: 3 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next));
      put(root, 'lib/extra.mjs', 'export const x = 3;\n');
    });
    assert.equal(v.ok, false);
    assert.ok(v.violations.length >= 3, v.text);
    assert.match(v.text, /connect_per_day/);
    assert.match(v.text, /nudge_min_days/);
    assert.match(v.text, /lib\/extra\.mjs/);
  }));

// M-002-S22 and M-002-S23 (CLI)
test('M-002-S22 CLI exits 1 with one line per violation and exits 0 on a clean tag', () =>
  withRepo(async (root) => {
    const cli = (base, head) => spawnSync(process.execPath, [join(root, 'scripts', 'check-safety-tag.mjs'), base, head], { cwd: root, encoding: 'utf8' });
    const good = budgetSource({ connect: 15 });
    put(root, 'scripts/budget.mjs', good);
    put(root, 'compat.json', compatJson(good));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'lower');
    git(root, 'tag', 'lower');
    const pass = cli('base', 'lower');
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);

    const bad = budgetSource({ connect: 30 });
    put(root, 'scripts/budget.mjs', bad);
    put(root, 'compat.json', compatJson(bad));
    put(root, 'lib/extra.mjs', 'export const x = 9;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'raise');
    git(root, 'tag', 'raise');
    const fail = cli('lower', 'raise');
    assert.equal(fail.status, 1);
    const lines = (fail.stdout + fail.stderr).split('\n').filter((l) => l.trim());
    assert.ok(lines.length >= 2, lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('connect_per_day')));
    assert.ok(lines.some((l) => l.includes('lib/extra.mjs')));
  }));

// M-001: safety-tag baseline fallback
const commitAs = (root, tagName, mutate, msg = tagName) => {
  mutate();
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
  git(root, 'tag', tagName);
};
const lowerConnect = (root) => () => {
  const next = budgetSource({ connect: 15 });
  put(root, 'scripts/budget.mjs', next);
  put(root, 'compat.json', compatJson(next));
};
const touchExtra = (root, n) => () => put(root, 'lib/extra.mjs', `export const x = ${n};\n`);
const oneArg = (root, tag) => spawnSync(process.execPath, [join(root, 'scripts', 'check-safety-tag.mjs'), tag], { cwd: root, encoding: 'utf8' });

// M-001-S1
test('M-001-S1 one-arg CLI on a clean safety tag cut from v0.1.0 compares with v0.1.0 and exits 0', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v0.1.0');
    commitAs(root, 'safety-1', lowerConnect(root));
    const res = oneArg(root, 'safety-1');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /comparing safety-1 with v0\.1\.0/);
  }));

// M-001-S2
test('M-001-S2 pickBase returns the nearest ancestor safety tag with reason previous', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v0.1.0');
    commitAs(root, 'safety-1', touchExtra(root, 2));
    commitAs(root, 'safety-2', touchExtra(root, 3));
    const res = checker.pickBase({ packRoot: root, tag: 'safety-2' });
    assert.equal(res.base, 'safety-1');
    assert.equal(res.reason, 'previous');
  }));

// M-001-S3
test('M-001-S3 a v tag on a descendant commit is never picked as the base', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v0.1.0');
    commitAs(root, 'safety-1', touchExtra(root, 2));
    commitAs(root, 'v0.2.0', touchExtra(root, 3));
    const res = checker.pickBase({ packRoot: root, tag: 'safety-1' });
    assert.equal(res.base, 'v0.1.0');
    assert.notEqual(res.base, 'v0.2.0');
  }));

// M-001-S4
test('M-001-S4 with no ancestor release or safety tag pickBase returns the lowest v tag with reason baseline', () =>
  withRepo(async (root) => {
    commitAs(root, 'safety-1', touchExtra(root, 2));
    git(root, 'switch', '-q', '-c', 'side', 'base');
    commitAs(root, 'v0.1.0', touchExtra(root, 5));
    commitAs(root, 'v0.2.0', touchExtra(root, 6));
    const res = checker.pickBase({ packRoot: root, tag: 'safety-1' });
    assert.equal(res.base, 'v0.1.0');
    assert.equal(res.reason, 'baseline');
  }));

// M-001-S5
test('M-001-S5 with no v tag pickBase throws NoBaselineError', () =>
  withRepo(async (root) => {
    commitAs(root, 'safety-1', touchExtra(root, 2));
    assert.equal(typeof checker.NoBaselineError, 'function');
    assert.throws(() => checker.pickBase({ packRoot: root, tag: 'safety-1' }), checker.NoBaselineError);
  }));

// M-001-S6
test('M-001-S6 with no v tag the one-arg CLI exits 1 and tells the maintainer to cut the first release', () =>
  withRepo(async (root) => {
    commitAs(root, 'safety-1', touchExtra(root, 2));
    const res = oneArg(root, 'safety-1');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /cut the first release/);
    assert.match(res.stderr, /docs\/maintenance\.md/);
    assert.match(res.stderr, /Releases/);
  }));

// M-001-S7
test('M-001-S7 one-arg run on a safety tag that touches lib/extra.mjs exits 1 naming the file', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v0.1.0');
    commitAs(root, 'safety-1', touchExtra(root, 2));
    const res = oneArg(root, 'safety-1');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.split('\n').some((l) => l.includes('lib/extra.mjs')), res.stdout);
  }));

// M-001-S8
test('M-001-S8 two-arg CLI keeps its exit codes and violation lines', () =>
  withRepo(async (root) => {
    const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'check-safety-tag.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    commitAs(root, 'good', lowerConnect(root));
    commitAs(root, 'bad', touchExtra(root, 2));
    assert.equal(run('base', 'good').status, 0);
    const fail = run('good', 'bad');
    assert.equal(fail.status, 1);
    assert.ok(fail.stdout.includes('lib/extra.mjs'));
  }));

// M-001-S6 usage
test('M-001-S6 zero or three arguments raise the two-form usage error with exit 2', () =>
  withRepo(async (root) => {
    const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'check-safety-tag.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    for (const args of [[], ['a', 'b', 'c']]) {
      const res = run(...args);
      assert.equal(res.status, 2, res.stdout + res.stderr);
      assert.match(res.stderr, /usage: check-safety-tag\.mjs <tag> \| <base> <head>/);
    }
  }));

// W-011-S4 the previous path accepts only vMAJOR.MINOR.PATCH release tags, like the baseline path.
test('W-011-S4 pickBase skips a nearer non-semver v tag on the previous path', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v0.1.0');
    commitAs(root, 'v0.2-beta', touchExtra(root, 2));
    commitAs(root, 'v1', touchExtra(root, 3));
    commitAs(root, 'safety-1', touchExtra(root, 4));
    const res = checker.pickBase({ packRoot: root, tag: 'safety-1' });
    assert.equal(res.base, 'v0.1.0');
    assert.equal(res.reason, 'previous');
  }));

test('W-011-S4 pickBase falls back to the baseline when the only ancestor v tags are non-semver', () =>
  withRepo(async (root) => {
    git(root, 'tag', 'v2-rc');
    commitAs(root, 'safety-1', touchExtra(root, 2));
    git(root, 'switch', '-q', '-c', 'side', 'base');
    commitAs(root, 'v0.3.0', touchExtra(root, 5));
    const res = checker.pickBase({ packRoot: root, tag: 'safety-1' });
    assert.equal(res.base, 'v0.3.0');
    assert.equal(res.reason, 'baseline');
  }));

const GUARDED_IMPORTS = "import { realpathSync } from 'node:fs';\nimport { resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n";
const GUARD_LINE = "\nasync function main() {}\nif (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await main();\n";
const guardedBudget = (opts) => GUARDED_IMPORTS + budgetSource(opts) + GUARD_LINE;

test('M-001-S5 a ref whose budget.mjs ends with the v0.1.0 realpath guard still compares ceilings', () =>
  withRepo(async (root) => {
    const base = guardedBudget();
    put(root, 'scripts/budget.mjs', base);
    put(root, 'compat.json', compatJson(base));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'guarded base');
    git(root, 'tag', '-f', 'base');
    const next = guardedBudget({ extra: '\n  // touched' });
    put(root, 'scripts/budget.mjs', next);
    put(root, 'compat.json', compatJson(next));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'equal head');
    const equal = await checkSafetyDiff({ packRoot: root, base: 'base', head: 'HEAD' });
    assert.equal(equal.ok ?? (equal.violations ?? []).length === 0, true, JSON.stringify(equal));
    const loose = guardedBudget({ connect: 25 });
    put(root, 'scripts/budget.mjs', loose);
    put(root, 'compat.json', compatJson(loose));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'loosened head');
    const res = await checkSafetyDiff({ packRoot: root, base: 'base', head: 'HEAD' });
    const text = (res.violations ?? []).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
    assert.equal(res.ok, false);
    assert.match(text, /connect_per_day/);
    assert.match(text, /raised/);
  }));

// W-024-A63 the gate also fences everything in budget.mjs outside CEILINGS, and never runs a head it has not vetted.
const markerEnv = (root) => {
  const marker = join(root, 'head-ran.marker');
  process.env.W024_MARKER = marker;
  return marker;
};
const WRITE_MARKER = "process.getBuiltinModule('node:fs').writeFileSync(process.env.W024_MARKER, 'ran');";
const withMarker = (fn) => (root) => fn(root, markerEnv(root)).finally(() => delete process.env.W024_MARKER);
const pinned = (root, next) => {
  put(root, 'scripts/budget.mjs', next);
  put(root, 'compat.json', compatJson(next));
};

test('W-024-A63-1 a logic change outside CEILINGS with a new budgetSha256 fails and the head module never runs', () =>
  withRepo(withMarker(async (root, marker) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ logic: `export const looser = false;\n${WRITE_MARKER}` })));
    assert.equal(v.ok, false);
    assert.match(v.text, /budget\.mjs changed outside CEILINGS/);
    assert.equal(existsSync(marker), false, 'head budget.mjs was executed');
  })));

test('W-024-A63-2 a one-line edit to a function outside CEILINGS fails even when every ceiling is unchanged', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ logic: 'export const looser = false;' })));
    assert.equal(v.ok, false);
    assert.match(v.text, /outside CEILINGS/);
  }));

test('W-024-A63-3 a CRLF-only rewrite of budget.mjs is not a change outside CEILINGS', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ connect: 15 }).replace(/\n/g, '\r\n')));
    assert.equal(v.ok, true, v.text);
  }));

test('W-024-A63-4 a pure tightening inside CEILINGS, with comment lines added, still passes', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ connect: 10, nudgeMin: 6, extra: "\n  // Handshake\n  pages_per_search: down(4, 'count', 'search')," })));
    assert.equal(v.ok, true, v.text);
  }));

test('W-024-A63-5 a non-literal entry inside CEILINGS fails and the head module never runs', () =>
  withRepo(withMarker(async (root, marker) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ extra: `\n  sneaky: down((${WRITE_MARKER.slice(0, -1)}, 1), 'count', 'day'),` })));
    assert.equal(v.ok, false);
    assert.match(v.text, /CEILINGS holds more than plain entries/);
    assert.equal(existsSync(marker), false, 'head budget.mjs was executed');
  })));

test('W-024-A63-6 a comment line that hides code behind a bare carriage return fails and the head module never runs', () =>
  withRepo(withMarker(async (root, marker) => {
    const v = await verdict(root, () => pinned(root, budgetSource({ extra: `\n  // note\r${WRITE_MARKER}` })));
    assert.equal(v.ok, false);
    assert.match(v.text, /CEILINGS holds more than plain entries/);
    assert.equal(existsSync(marker), false, 'head budget.mjs was executed');
  })));

test('W-024-A63-7 a head whose CEILINGS block uses another factory than freeze fails and the head module never runs', () =>
  withRepo(withMarker(async (root, marker) => {
    const next = budgetSource({ logic: `export const looser = true;\n${WRITE_MARKER}` }).replace('Object.freeze({', 'Object.assign({');
    const v = await verdict(root, () => pinned(root, next));
    assert.equal(v.ok, false);
    assert.equal(existsSync(marker), false, 'head budget.mjs was executed');
  })));

test('W-024-A63-8 a compat.json budgetSha256 that is not the hash of the head budget.mjs fails', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      const next = budgetSource({ connect: 15 });
      put(root, 'scripts/budget.mjs', next);
      put(root, 'compat.json', compatJson(next, { budgetSha256: 'a'.repeat(64) }));
    });
    assert.equal(v.ok, false);
    assert.match(v.text, /compat\.json budgetSha256 does not match budget\.mjs/);
  }));

test('W-024-A63-9 a compat.json change with budget.mjs untouched must still pin the hash of the head budget.mjs', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'compat.json', compatJson(budgetSource(), { budgetSha256: 'b'.repeat(64) })));
    assert.equal(v.ok, false);
    assert.match(v.text, /does not match budget\.mjs/);
  }));

test('W-024-A63-10 a budget.mjs change with compat.json untouched leaves a stale pin and is refused', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'scripts/budget.mjs', budgetSource({ connect: 10 })));
    assert.equal(v.ok, false);
    assert.match(v.text, /does not match budget\.mjs/);
  }));

test('W-024-A63-11 a padded CEILINGS line longer than any real entry is refused without a slow match', () =>
  withRepo(async (root) => {
    const start = Date.now();
    const v = await verdict(root, () => pinned(root, budgetSource({ extra: `\n  pad: down([${' '.repeat(60000)}], 'count', 'day'),` })));
    assert.equal(v.ok, false);
    assert.match(v.text, /CEILINGS holds more than plain entries/);
    assert.ok(Date.now() - start < 2000, 'the gate answered quickly');
  }));
