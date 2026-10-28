// Assumed: scripts/cycle.mjs exports computeCycle({ tracks, calendar, today, experienceYears }) and
// main(argv, deps) -> exit code, where deps = { config, preset, today, out } replaces config loading, preset loading,
// the wall clock and console output. main may throw UsageError for exit 2.
// calendar = { rollover_month, lead_months, terms: [{ name, start_month }] }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { computeCycle, main } from '../../scripts/cycle.mjs';
import { UsageError } from '../../lib/args.mjs';
import { readCycle } from '../../lib/cycle-file.mjs';
import { makeRoot, runScript, TODAY } from '../helpers/script-harness.mjs';

const CAL = {
  rollover_month: 7,
  lead_months: 12,
  terms: [
    { name: 'Spring', start_month: 1 },
    { name: 'Summer', start_month: 6 },
    { name: 'Fall', start_month: 8 },
  ],
};
const TRACKS = [
  { kind: 'internship', graduation: '2028-05', resume_variant: 'intern-a' },
  { kind: 'newgrad', graduation: '2027-05', resume_variant: 'grad-a' },
];
const CONFIG = { tracks: TRACKS, experience_years: 1, presets: ['example'] };
const PRESET_MERGED = { id: 'example', recruiting_calendar: CAL };

const exitOf = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UsageError) return 2;
    throw err;
  }
};

// M-004-S1
test('M-004-S1 computeCycle derives terms and years from the calendar', () => {
  const c = computeCycle({ tracks: TRACKS, calendar: CAL, today: TODAY, experienceYears: 1 });
  assert.equal(typeof c.phase, 'string');
  assert.deepEqual(c.terms.map((t) => t.name), ['Spring', 'Summer', 'Fall']);
  assert.deepEqual(c.terms.map((t) => t.year), [2027, 2027, 2027]);
  assert.deepEqual(c.terms.map((t) => t.start), ['2027-01-01', '2027-06-01', '2027-08-01']);
  assert.ok(c.newgrad_years.includes(2027));
  assert.ok(Array.isArray(c.internship_years) && c.internship_years.every(Number.isInteger));
  assert.ok(Number.isInteger(c.experience_ceiling_years));
});

// M-004-S1
test('M-004-S1 the default run writes data/student-cycle.json', async () => {
  const r = makeRoot();
  try {
    const code = await main(['--root', r.root, '--data-dir', r.data], { config: CONFIG, preset: PRESET_MERGED, today: TODAY, out: () => {} });
    assert.equal(code, 0);
    const c = readCycle(r.file('data/student-cycle.json'));
    assert.equal(c.today, TODAY);
    assert.deepEqual(c.terms.map((t) => t.name), ['Spring', 'Summer', 'Fall']);
    assert.ok(c.terms.every((t) => t.year === 2027));
  } finally {
    r.cleanup();
  }
});

// M-004-S2
test('M-004-S2 terms roll to the next year once today passes the rollover month', () => {
  const year = (today, cal = CAL) => computeCycle({ tracks: TRACKS, calendar: cal, today, experienceYears: 0 }).terms[0].year;
  assert.equal(year('2026-03-10'), 2026);
  assert.equal(year('2026-06-30'), 2026);
  assert.equal(year('2026-08-15'), 2027);
  assert.equal(year('2026-12-31'), 2027);
});

// M-004-S2
test('M-004-S2 the rollover month comes from the calendar, not a constant', () => {
  const late = { ...CAL, rollover_month: 9 };
  const year = (today, cal) => computeCycle({ tracks: TRACKS, calendar: cal, today, experienceYears: 0 }).terms[0].year;
  assert.equal(year('2026-08-15', CAL), 2027);
  assert.equal(year('2026-08-15', late), 2026);
  assert.equal(year('2026-10-15', late), 2027);
});

const BRIEF = ['# Brief', 'Keep this intro.', '<!-- cycle:start terms -->', 'STALE-PLACEHOLDER', '<!-- cycle:end terms -->', 'Keep this outro.', ''].join('\n');
const CUSTOM = ['# Custom', '<!-- cycle:start years -->', 'STALE-PLACEHOLDER', '<!-- cycle:end years -->', 'Own notes stay.', ''].join('\n');
const PORTALS = ['# portals', 'tracked_companies: []', '# cycle:start search', 'search_queries: []', '# cycle:end search', 'title_filter: keep', ''].join('\n');

const stripBlocks = (text) =>
  text.replace(/(<!-- cycle:start [^>]*-->)[\s\S]*?(<!-- cycle:end [^>]*-->)/g, '$1$2').replace(/(# cycle:start [^\n]*\n)[\s\S]*?(# cycle:end [^\n]*)/g, '$1$2');

// M-004-S2
test('M-004-S2 the write rewrites only the marked blocks in the brief, custom and portals files', async () => {
  const r = makeRoot();
  try {
    r.write('modes/_brief.md', BRIEF);
    r.write('modes/_custom.md', CUSTOM);
    r.write('portals.yml', PORTALS);
    const code = await main(['--root', r.root, '--data-dir', r.data], { config: CONFIG, preset: PRESET_MERGED, today: TODAY, out: () => {} });
    assert.equal(code, 0);
    for (const [rel, before] of [['modes/_brief.md', BRIEF], ['modes/_custom.md', CUSTOM], ['portals.yml', PORTALS]]) {
      const after = r.read(rel);
      assert.equal(stripBlocks(after), stripBlocks(before), `${rel} changed outside its cycle blocks`);
      assert.match(after, /cycle:start/);
      assert.match(after, /cycle:end/);
    }
    assert.ok(!r.read('modes/_brief.md').includes('STALE-PLACEHOLDER'));
    assert.ok(!r.read('modes/_custom.md').includes('STALE-PLACEHOLDER'));
    assert.match(r.read('modes/_brief.md'), /2027/);
    const portals = yaml.load(r.read('portals.yml'));
    assert.equal(portals.title_filter, 'keep');
    assert.deepEqual(portals.tracked_companies, []);
  } finally {
    r.cleanup();
  }
});

// M-004-S2
test('M-004-S2 --json prints the cycle and writes nothing', async () => {
  const r = makeRoot();
  try {
    r.write('modes/_brief.md', BRIEF);
    const lines = [];
    const code = await main(['--root', r.root, '--data-dir', r.data, '--json', '--today', '2026-03-10'], { config: CONFIG, preset: PRESET_MERGED, out: (s) => lines.push(s) });
    assert.equal(code, 0);
    const printed = JSON.parse(lines.join('\n'));
    assert.ok(printed.terms.every((t) => t.year === 2026));
    assert.ok(!r.exists('data/student-cycle.json'));
    assert.equal(r.read('modes/_brief.md'), BRIEF);
  } finally {
    r.cleanup();
  }
});

// M-004-S3
test('M-004-S3 --today without --dry-run or --json exits 2 and writes nothing', async () => {
  const r = makeRoot();
  try {
    r.write('modes/_brief.md', BRIEF);
    const code = await exitOf(() => main(['--root', r.root, '--data-dir', r.data, '--today', TODAY], { config: CONFIG, preset: PRESET_MERGED, out: () => {} }));
    assert.equal(code, 2);
    assert.ok(!r.exists('data/student-cycle.json'));
    assert.equal(r.read('modes/_brief.md'), BRIEF);
  } finally {
    r.cleanup();
  }
});

// M-004-S3
test('M-004-S3 the real CLI exits 2 for --today alone and writes nothing', () => {
  const r = makeRoot();
  try {
    const out = runScript('cycle', [], r);
    assert.equal(out.code, 2);
    assert.ok(!r.exists('data/student-cycle.json'));
  } finally {
    r.cleanup();
  }
});
