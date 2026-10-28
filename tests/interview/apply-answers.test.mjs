// Assumed: interview/apply-answers.mjs exports applyAnswers({ answers, root, today, dryRun }) -> Promise (resolves on success)
// and runs as a CLI: `node interview/apply-answers.mjs --root R --data-dir R/data --today D [--dry-run]`, reading
// <data-dir>/interview-answers.json. Exit 0 on success, 1 on a schema failure with no file written.
// Pack blocks: portals.yml uses '# student-pack:start NAME' ... '# student-pack:end NAME'; mode files use
// '<!-- student-pack:start -->' ... '<!-- student-pack:end -->'. Blocks are named after location_filter, title_filter, tracked_companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { applyAnswers } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { readCycle } from '../../lib/cycle-file.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const SETS = ['cs', 'mis', 'finance', 'mechanical', 'nursing'];
const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));
const PLACEHOLDER = /\{\{|\}\}|\[\[[A-Z_]+\]\]|__[A-Z][A-Z_]+__|<<[A-Z_]+>>|\$\{[A-Z_]+\}/;
const MODES = ['_brief', '_custom', '_profile'];

function scratch(answers) {
  const root = mkdtempSync(join(tmpdir(), 'pack-interview-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  if (answers) writeFileSync(join(root, 'data', 'interview-answers.json'), JSON.stringify(answers, null, 2));
  return {
    root,
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    write: (rel, t) => writeFileSync(join(root, rel), t),
    exists: (rel) => existsSync(join(root, rel)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(r, extra = []) {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'apply-answers.mjs'), '--root', r.root, '--data-dir', join(r.root, 'data'), '--today', TODAY, ...extra], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

function snapshot(dir) {
  const acc = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else acc[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return acc;
}

const stripYamlBlocks = (t) => t.replace(/^[ \t]*# student-pack:start (\S+)[^\n]*\n[\s\S]*?^[ \t]*# student-pack:end \1[^\n]*\n?/gm, '');
const stripMdBlocks = (t) => t.replace(/<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->\n?/g, '');
const squash = (t) => t.replace(/\n{2,}/g, '\n').trim();

// M-006-S1
for (const k of SETS) {
  test(`M-006-S1 apply-answers on the ${k} answer set writes student.yml, student-cycle.json and portals blocks`, async () => {
    const answers = answersOf(k);
    const r = scratch(answers);
    try {
      const res = run(r);
      assert.equal(res.code, 0, res.stderr);
      const cfg = await loadStudentConfig({ root: r.root });
      assert.ok(cfg, 'student.yml loads and validates');
      assert.equal(cfg.onboarding.complete, true);
      assert.deepEqual([...cfg.presets], answers.presets);
      assert.deepEqual(cfg.tracks.map((t) => ({ ...t })), answers.tracks);
      assert.equal(cfg.timezone, answers.timezone);
      assert.deepEqual([...cfg.locations], answers.locations);
      assert.equal(cfg.daily_target, answers.daily_target);
      assert.equal(cfg.score_floor, answers.score_floor);
      assert.equal(cfg.automation, answers.automation);
      assert.equal(cfg.mailbox.backend, answers.mailbox_backend);
      assert.equal(cfg.schedule.time, answers.schedule_time);
      assert.deepEqual({ ...cfg.switches }, answers.switches);
      assert.deepEqual([...cfg.dealbreakers], answers.dealbreakers);
      assert.ok(readCycle(join(r.root, 'data', 'student-cycle.json')), 'student-cycle.json is valid');

      const portals = r.read('portals.yml');
      for (const name of ['location_filter', 'title_filter', 'tracked_companies']) {
        assert.match(portals, new RegExp(`^[ \\t]*# student-pack:start\\s+\\S*${name}`, 'm'), `block ${name}`);
      }
      const doc = yaml.load(portals);
      const seeds = loadPreset(answers.presets[0]).seed_employers.map((e) => e.name.toLowerCase());
      const targets = answers.target_employers.map((e) => e.name.toLowerCase());
      const names = doc.tracked_companies.map((e) => e.name.toLowerCase());
      for (const n of targets) assert.ok(names.includes(n), `target ${n} tracked`);
      assert.equal(names.length, new Set([...seeds, ...targets]).size);
      assert.ok(Array.isArray(doc.location_filter?.allow ?? doc.location_filter) || typeof doc.location_filter === 'object');
      assert.ok(doc.title_filter);
    } finally {
      r.cleanup();
    }
  });
}

test('M-006-S1 applyAnswers({answers, root, today}) writes the same files in process', async () => {
  const r = scratch(null);
  try {
    await applyAnswers({ answers: answersOf('cs'), root: r.root, today: TODAY });
    assert.ok(r.exists('config/student.yml'));
    assert.ok(r.exists('data/student-cycle.json'));
    assert.ok(r.exists('portals.yml'));
  } finally {
    r.cleanup();
  }
});

test('M-006-S1 a preset with sources writes trial github sources, and priority and blacklist land in blacklist.md', () => {
  const answers = answersOf('cs');
  const r = scratch(answers);
  try {
    r.write('data/blacklist.md', '# Blacklist\n\nUser Entry Corp\n');
    assert.equal(run(r).code, 0);
    const gh = r.read('data/student-github-sources.json');
    assert.doesNotThrow(() => JSON.parse(gh));
    assert.match(gh, /"trial"/);
    const bl = r.read('data/blacklist.md');
    assert.ok(bl.startsWith('# Blacklist\n\nUser Entry Corp\n'));
    for (const c of [...answers.blacklist, ...answers.priority_companies]) assert.ok(bl.includes(c), c);
  } finally {
    r.cleanup();
  }
});

test('M-006-S1 --dry-run writes nothing and lists files', () => {
  const r = scratch(answersOf('cs'));
  try {
    const before = snapshot(r.root);
    const res = run(r, ['--dry-run']);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(snapshot(r.root), before);
    assert.match(res.stdout, /student\.yml/);
  } finally {
    r.cleanup();
  }
});

test('M-006-S1 a second run is idempotent', () => {
  const r = scratch(answersOf('mis'));
  try {
    assert.equal(run(r).code, 0);
    const norm = (s) => Object.fromEntries(Object.entries(s).map(([f, t]) => [f, f.endsWith('student-cycle.json') ? t.replace(/"computed_at":\s*"[^"]*"/, '') : t]));
    const first = norm(snapshot(r.root));
    assert.equal(run(r).code, 0);
    assert.deepEqual(norm(snapshot(r.root)), first);
  } finally {
    r.cleanup();
  }
});

// M-006-S2
for (const k of SETS) {
  test(`M-006-S2 ${k}: _brief, _custom and _profile carry archetypes and dealbreakers with no placeholder`, () => {
    const answers = answersOf(k);
    const r = scratch(answers);
    try {
      assert.equal(run(r).code, 0);
      for (const m of MODES) {
        const t = r.read(`modes/${m}.md`);
        assert.match(t, /<!-- student-pack:start -->[\s\S]*<!-- student-pack:end -->/, m);
        assert.doesNotMatch(t, PLACEHOLDER, `${m} placeholder`);
        for (const a of answers.archetypes) assert.ok(t.includes(a), `${m} archetype ${a}`);
        for (const d of answers.dealbreakers) assert.ok(t.includes(d), `${m} dealbreaker ${d}`);
      }
    } finally {
      r.cleanup();
    }
  });
}

// M-006-S3
test('M-006-S3 user content outside pack blocks stays byte-identical in portals.yml and mode files', () => {
  const r = scratch(answersOf('cs'));
  try {
    const userPortals = '# my own notes\nsearch_notes: keep this line exactly\n';
    const userMode = '# My rules\n\nKeep    this   spacing and\ttabs.\n';
    r.write('portals.yml', userPortals);
    for (const m of MODES) r.write(`modes/${m}.md`, userMode);
    assert.equal(run(r).code, 0);
    assert.ok(r.read('portals.yml').includes(userPortals));
    for (const m of MODES) assert.ok(r.read(`modes/${m}.md`).includes(userMode), m);
    assert.doesNotThrow(() => yaml.load(r.read('portals.yml')));
  } finally {
    r.cleanup();
  }
});

test('M-006-S3 an existing pack block is replaced in place and user text on both sides is kept', () => {
  const r = scratch(answersOf('cs'));
  try {
    const topP = '# above\nsearch_notes: a\n';
    const botP = 'other_user_key: b\n';
    r.write('portals.yml', `${topP}# student-pack:start tracked_companies\ntracked_companies:\n  - name: Stale Co\n    careers_url: https://careers.example.com/stale\n    enabled: true\n# student-pack:end tracked_companies\n${botP}`);
    const topM = '# above the block\n';
    const botM = '\nBelow the block, user text.\n';
    for (const m of MODES) r.write(`modes/${m}.md`, `${topM}<!-- student-pack:start -->\nold body\n<!-- student-pack:end -->${botM}`);
    assert.equal(run(r).code, 0);
    const p = r.read('portals.yml');
    assert.doesNotMatch(p, /Stale Co/);
    assert.equal(squash(stripYamlBlocks(p)), squash(`${topP}${botP}`));
    assert.equal((p.match(/# student-pack:start\s+\S*tracked_companies/g) ?? []).length, 1);
    assert.doesNotThrow(() => yaml.load(p));
    for (const m of MODES) {
      const t = r.read(`modes/${m}.md`);
      assert.doesNotMatch(t, /old body/);
      assert.equal((t.match(/<!-- student-pack:start -->/g) ?? []).length, 1);
      assert.equal(squash(stripMdBlocks(t)), squash(`${topM}${botM}`));
    }
  } finally {
    r.cleanup();
  }
});

// M-006-S4
test('M-006-S4 an answer set that fails the schema exits 1 and writes no file', () => {
  const bad = { ...answersOf('cs'), timezone: 12345, tracks: 'not a list' };
  const r = scratch(bad);
  try {
    r.write('config/student.yml', 'timezone: America/Chicago\n');
    const before = snapshot(r.root);
    const res = run(r);
    assert.equal(res.code, 1, res.stderr);
    assert.deepEqual(snapshot(r.root), before);
  } finally {
    r.cleanup();
  }
});

test('M-006-S4 a missing required block also exits 1 with nothing written', () => {
  const { presets, ...rest } = answersOf('cs');
  const r = scratch(rest);
  try {
    const before = snapshot(r.root);
    assert.equal(run(r).code, 1);
    assert.deepEqual(snapshot(r.root), before);
  } finally {
    r.cleanup();
  }
});

// M-006-S5
test('M-006-S5 limits looser than a ceiling are written as the ceiling', async () => {
  const answers = { ...answersOf('cs'), limits: { connect_per_day: 50, nudge_min_days: 2, message_per_day: 4 } };
  const r = scratch(answers);
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const cfg = await loadStudentConfig({ root: r.root });
    assert.equal(cfg.limits.connect_per_day, 20);
    assert.equal(cfg.limits.nudge_min_days, 5);
    assert.equal(cfg.limits.message_per_day, 4);
    assert.match(res.stdout, /connect_per_day/);
  } finally {
    r.cleanup();
  }
});
