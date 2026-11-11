// Regression 959: the interview's scan is bounded to 2 slices and reads the boards research added, then the target
// employers, then the boards nearest the student's locations, so the research boards are proved in the first slice.
// A live nursing run needed 40+ minutes for 76 seed boards (1, 9, then 18 done after three 5-minute slices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERVIEW_MAX_SLICES, scanOrder, sliceScan } from '../../lib/ingest.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const PORTALS = `tracked_companies:
  # student-pack:start tracked_companies
  - name: "Seattle Seed"
    careers_url: https://a.wd1.myworkdayjobs.com/seattle_careers
    enabled: true
  - name: "Plain Seed"
    careers_url: https://b.wd1.myworkdayjobs.com/plain
    enabled: true
  - name: "Boston Seed"
    careers_url: https://c.wd1.myworkdayjobs.com/boston_careers
    enabled: true
  - name: "Target Hospital"
    careers_url: https://d.wd1.myworkdayjobs.com/target
    enabled: true
  # student-pack:end tracked_companies
  # student-pack:start research_companies
  - name: "Researched Board"
    careers_url: https://boards.greenhouse.io/researched
    enabled: true
  # student-pack:end research_companies
`;

function setup() {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'portals.yml'), PORTALS);
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

function slicer(s, cost = 100_000) {
  let t = 0;
  const calls = [];
  const upstream = (script, args) => {
    calls.push(args[1]);
    t += cost;
    return '';
  };
  const run = (opts = {}) => sliceScan({ root: s.up.root, dataDir: s.data, upstream, today: TODAY, now: () => t, budgetMs: 250_000, ...opts });
  return { calls, run };
}

test('scanOrder puts research boards first, then target employers, then boards naming an earlier location, then the rest', () => {
  const companies = [
    { name: 'Plain Seed', careers_url: 'https://b.example/plain' },
    { name: 'Seattle Seed', careers_url: 'https://a.example/seattle' },
    { name: 'Boston Seed', careers_url: 'https://c.example/boston' },
    { name: 'Target Hospital', careers_url: 'https://d.example/t' },
    { name: 'Researched Board', careers_url: 'https://e.example/r' },
  ];
  const order = scanOrder(companies, { researched: new Set(['Researched Board']), targets: ['target hospital'], locations: ['Boston, MA', 'Seattle, WA', 'Remote US'] });
  assert.deepEqual(order, ['Researched Board', 'Target Hospital', 'Boston Seed', 'Seattle Seed', 'Plain Seed']);
});

test('the interview scan stops after 2 slices, reads research boards in the first slice and says the rest is left to the daily run', () => {
  const s = setup();
  try {
    const sl = slicer(s);
    const opts = { maxSlices: INTERVIEW_MAX_SLICES, targets: ['Target Hospital'], locations: ['Boston, MA'] };
    const first = sl.run(opts);
    assert.deepEqual(sl.calls, ['Researched Board', 'Target Hospital', 'Boston Seed'], 'research board, target employer, then the nearest seed in the first slice');
    assert.match(first, /^scan partial: 3 of 5 companies done, 2 left; run the same command again/);
    const second = sl.run(opts);
    assert.match(second, /^scan complete: 5 companies/);
    assert.equal(INTERVIEW_MAX_SLICES, 2);
  } finally {
    s.cleanup();
  }
});

test('a third call after the slice limit scans nothing and reports what is left', () => {
  const s = setup();
  try {
    const sl = slicer(s, 200_000);
    const opts = { maxSlices: 2 };
    sl.run(opts);
    const second = sl.run(opts);
    assert.match(second, /^scan stopped after 2 slices: \d of 5 companies done, \d left to the daily run; go on to the next step/);
    const before = sl.calls.length;
    const third = sl.run(opts);
    assert.equal(sl.calls.length, before, 'no company is started after the limit');
    assert.match(third, /^scan stopped after 2 slices/);
    assert.equal(JSON.parse(readFileSync(join(s.data, 'student-first-scan.json'), 'utf8')).slices, 2);
  } finally {
    s.cleanup();
  }
});

test('the interview text states the 2-slice bound and the real total, and no longer promises 15 minutes or endless repeats', () => {
  const md = readFileSync(join(PACK_ROOT, 'interview', 'interview.md'), 'utf8');
  assert.match(md, /up to about 20 minutes in all/);
  assert.match(md, /at most 2 slices of about 5 minutes/);
  assert.match(md, /`scan stopped`/);
  assert.doesNotMatch(md, /about 15 minutes in all/);
  assert.doesNotMatch(md, /for as long as its line says/);
});

test('the research prompt asks for the employer ATS careers URL, not a marketing page', () => {
  const md = readFileSync(join(PACK_ROOT, 'interview', 'interview.md'), 'utf8');
  assert.match(md, /applicant-tracking careers URL, never its marketing careers page/);
  assert.match(md, /myworkdayjobs\.com/);
});
