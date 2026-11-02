// W-027: research-cache stores company notes under data/research/<key>.md with a fetched date and refuses stale ones.
// The library functions take the date as a parameter (an injected clock); the CLI tests pin it with --today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cacheKey, createCache, formatNote, parseNote } from '../../scripts/research-cache.mjs';
import { createClock } from '../../lib/clock.mjs';
import { makeRoot, PACK_ROOT } from '../helpers/script-harness.mjs';

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
const at = (dir, today, limit = 30) => createCache({ dir: join(dir, 'research'), today: createClock({ today, timezone: 'UTC' }).today(), limit });

test('W-027-H1 the key folds company spellings and rejects names with nothing to key on', () => {
  assert.equal(cacheKey('Acme Robotics, Inc.'), 'acme-robotics');
  assert.equal(cacheKey('ACME robotics'), 'acme-robotics');
  assert.throws(() => cacheKey('???'), /no letters or digits/);
  assert.throws(() => cacheKey('Inc'), /no letters or digits/);
});

test('W-027-H2 put stores a header with the fetched date and get returns the body while fresh', () => {
  const s = scratch();
  try {
    const file = at(s.dir, '2026-10-01').put('Acme Robotics', '- makes arms\n- founded 2019');
    assert.equal(readFileSync(file, 'utf8'), '---\ncompany: Acme Robotics\nfetched: 2026-10-01\n---\n- makes arms\n- founded 2019\n');
    const got = at(s.dir, '2026-10-31').get('acme robotics inc');
    assert.equal(got.state, 'fresh');
    assert.equal(got.age, 30);
    assert.equal(got.note.body, '- makes arms\n- founded 2019\n');
  } finally {
    s.cleanup();
  }
});

test('W-027-H3 a note one day past the limit is stale; a missing note is a miss', () => {
  const s = scratch();
  try {
    at(s.dir, '2026-10-01').put('Acme', 'x');
    assert.equal(at(s.dir, '2026-11-01').get('Acme').state, 'stale');
    assert.equal(at(s.dir, '2026-11-01', 31).get('Acme').state, 'fresh');
    assert.equal(at(s.dir, '2026-11-01').get('Other').state, 'miss');
  } finally {
    s.cleanup();
  }
});

test('W-027-H4 put replaces the note and resets its date; an empty note is refused', () => {
  const s = scratch();
  try {
    at(s.dir, '2026-09-01').put('Acme', 'old');
    at(s.dir, '2026-11-01').put('Acme', 'new');
    const got = at(s.dir, '2026-11-02').get('Acme');
    assert.equal(got.state, 'fresh');
    assert.equal(got.note.body, 'new\n');
    assert.throws(() => at(s.dir, '2026-11-02').put('Acme', '  \n'), /empty/);
  } finally {
    s.cleanup();
  }
});

test('W-027-H5 prune deletes stale notes only, keeps fresh ones and files with no readable header, and dry run deletes nothing', () => {
  const s = scratch();
  try {
    at(s.dir, '2026-08-01').put('Old Robotics', 'x');
    at(s.dir, '2026-10-30').put('New Robotics', 'y');
    mkdirSync(join(s.dir, 'research'), { recursive: true });
    writeFileSync(join(s.dir, 'research', 'hand-written.md'), 'my own notes\n');
    const cache = at(s.dir, '2026-11-02');
    assert.deepEqual(cache.prune({ dryRun: true }).map((e) => e.key), ['old-robotics']);
    assert.deepEqual(readdirSync(join(s.dir, 'research')).sort(), ['hand-written.md', 'new-robotics.md', 'old-robotics.md']);
    assert.deepEqual(cache.prune().map((e) => e.key), ['old-robotics']);
    assert.deepEqual(readdirSync(join(s.dir, 'research')).sort(), ['hand-written.md', 'new-robotics.md']);
    assert.equal(cache.get('hand written').state, 'stale');
  } finally {
    s.cleanup();
  }
});

test('W-027-H6 list reports key, date, age and state; a note dated in the future counts as age 0', () => {
  const s = scratch();
  try {
    at(s.dir, '2026-11-10').put('Future Robotics', 'x');
    at(s.dir, '2026-09-01').put('Old Robotics', 'x');
    const rows = at(s.dir, '2026-11-02').list().map((e) => [e.key, e.age, e.fresh]);
    assert.deepEqual(rows, [['future-robotics', 0, true], ['old-robotics', 62, false]]);
  } finally {
    s.cleanup();
  }
});

test('W-027-H7 parseNote and formatNote round-trip and reject an impossible date', () => {
  const note = { company: 'Acme', fetched: '2026-10-01', body: 'b\n' };
  assert.deepEqual(parseNote(formatNote(note)), note);
  assert.equal(parseNote('---\ncompany: A\nfetched: 2026-02-30\n---\nb\n'), null);
  assert.equal(parseNote('no header'), null);
});

const cli = (r, args, { input, today = '2026-11-02' } = {}) => {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'research-cache.mjs'), ...args, '--root', r.root, '--data-dir', r.data, '--today', today], { cwd: PACK_ROOT, encoding: 'utf8', input });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
};

test('W-027-H8 CLI put from stdin, get fresh (0), stale (3) and none (4), using research_cache_days', () => {
  const r = makeRoot({ config: 'research_cache_days: 10\n' });
  try {
    assert.equal(cli(r, ['put', 'Acme Robotics'], { input: '- makes arms', today: '2026-10-20' }).code, 0);
    assert.ok(existsSync(join(r.data, 'research', 'acme-robotics.md')));
    const fresh = cli(r, ['get', 'Acme Robotics'], { today: '2026-10-30' });
    assert.equal(fresh.code, 0);
    assert.match(fresh.stdout, /fetched: 2026-10-20 \(10 days old, limit 10\)/);
    assert.match(fresh.stdout, /- makes arms/);
    const stale = cli(r, ['get', 'Acme Robotics'], { today: '2026-10-31' });
    assert.equal(stale.code, 3);
    assert.equal(stale.stdout, '');
    assert.match(stale.stderr, /stale, fetched 2026-10-20, 11 days old \(limit 10\)/);
    assert.equal(cli(r, ['get', 'Nobody']).code, 4);
  } finally {
    r.cleanup();
  }
});

test('W-027-H9 CLI put from a file, list, prune --dry-run then prune; the default limit is 30 days', () => {
  const r = makeRoot();
  try {
    r.write('note.md', 'from a file');
    assert.equal(cli(r, ['put', 'Beta Robotics', r.file('note.md')], { today: '2026-09-01' }).code, 0);
    assert.match(cli(r, ['list']).stdout, /^beta-robotics\tfetched 2026-09-01\t62 days\tstale$/m);
    assert.match(cli(r, ['prune', '--dry-run']).stdout, /would delete beta-robotics.*\n1 stale note found/);
    assert.ok(existsSync(join(r.data, 'research', 'beta-robotics.md')));
    assert.match(cli(r, ['prune']).stdout, /deleted beta-robotics.*\n1 stale note deleted \(limit 30 days\)/);
    assert.equal(existsSync(join(r.data, 'research', 'beta-robotics.md')), false);
  } finally {
    r.cleanup();
  }
});

test('W-027-H10 usage errors exit 2', () => {
  const r = makeRoot();
  try {
    assert.equal(cli(r, ['get']).code, 2);
    assert.equal(cli(r, ['put', '???'], { input: 'x' }).code, 2);
    assert.equal(cli(r, ['frobnicate']).code, 2);
  } finally {
    r.cleanup();
  }
});
