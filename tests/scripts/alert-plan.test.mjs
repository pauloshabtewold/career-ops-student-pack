// scripts/alert-plan.mjs [--root R] [--data-dir D] [--json]: a numbered batch of job-alert setups, one item per site, built
// from config/student.yml (presets, tracks, locations) and the archetypes in data/interview-answers.json. It makes no
// network request; the CLI runs here with a preload that throws on any fetch or socket connect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NO_NETWORK = `data:text/javascript,${encodeURIComponent("import net from 'node:net'; globalThis.fetch = () => { throw new Error('network request attempted'); }; net.Socket.prototype.connect = () => { throw new Error('network request attempted'); };")}`;

const TRACK = (kind) => `  - {kind: ${kind}, graduation: "2028-05", resume_variant: main}`;

function setup({ presets, tracks = ['internship'], locations = ['Austin, TX'], archetypes = ['Brand Strategist', 'Event Planner'] }) {
  const root = mkdtempSync(join(tmpdir(), 'alert-plan-'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\npresets: [${presets.join(', ')}]\ntracks:\n${tracks.map(TRACK).join('\n')}\nlocations: [${locations.map((l) => JSON.stringify(l)).join(', ')}]\n`);
  writeFileSync(join(root, 'data', 'interview-answers.json'), `${JSON.stringify({ archetypes, locations })}\n`);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(s, extra = []) {
  const r = spawnSync(process.execPath, ['--import', NO_NETWORK, join(PACK_ROOT, 'scripts', 'alert-plan.mjs'), '--root', s.root, '--data-dir', join(s.root, 'data'), ...extra], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Splits the numbered part of the output into one text block per item; the 'Upcoming' section is returned apart.
function parse(stdout) {
  const [head, ...rest] = stdout.split(/^.*Upcoming and check by hand.*$/m);
  const blocks = head.split(/^\s*\d+[.)]\s+/m).slice(1);
  return { blocks, upcoming: rest.join('\n') };
}

// Space as %20 or +, comma as %2C or a plain comma: the spec says URL-encoded without naming the form.
const enc = (text) => text.split('').map((c) => (c === ' ' ? '(?:%20|\\+)' : c === ',' ? '(?:%2C|,)' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');

// M-001-S11-cdel
test('M-001-S11-cdel alert-plan prints numbered LinkedIn, Handshake, Simplify and Indeed items for a byo student, each with purpose, recommendation and URL', () => {
  const s = setup({ presets: ['byo-employer-list'] });
  try {
    const r = run(s);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const { blocks } = parse(r.stdout);
    assert.equal(blocks.length, 4, r.stdout);
    const sites = ['LinkedIn', 'Handshake', 'Simplify', 'Indeed'];
    sites.forEach((site, i) => assert.match(blocks[i], new RegExp(site), `item ${i + 1} is ${site}`));
    const kinds = ['recommended', 'recommended', 'optional', 'optional'];
    kinds.forEach((kind, i) => assert.match(blocks[i], new RegExp(`\\(${kind}\\b`), `${sites[i]} is ${kind}`));
    for (const [i, b] of blocks.entries()) assert.match(b, /https:\/\//, `${sites[i]} has a URL`);
    assert.match(blocks[0], /Set alert/);
    assert.match(blocks[1], /Save search/);
    assert.match(blocks[3], /Get new jobs by email/);
  } finally {
    s.cleanup();
  }
});

test('extra check: the search URLs are prefilled from the first archetype, the track and the first location', () => {
  const s = setup({ presets: ['byo-employer-list'] });
  try {
    const { stdout } = run(s);
    const q = enc('Brand Strategist intern');
    assert.match(stdout, new RegExp(`https://www\\.linkedin\\.com/jobs/search/\\?keywords=${q}&location=${enc('Austin, TX')}&f_E=1`));
    assert.match(stdout, new RegExp(`https://app\\.joinhandshake\\.com/job-search\\?query=${q}`));
    assert.match(stdout, new RegExp(`https://simplify\\.jobs/jobs\\?query=${q}`));
    assert.match(stdout, new RegExp(`https://www\\.indeed\\.com/jobs\\?q=${q}&l=${enc('Austin, TX')}`));
    assert.doesNotMatch(stdout, /Event(%20|\+| )Planner/, 'only the first archetype is used');
  } finally {
    s.cleanup();
  }
});

test('extra check: a new-grad track uses new grad in the query and f_E=2 on LinkedIn', () => {
  const s = setup({ presets: ['byo-employer-list'], tracks: ['newgrad'] });
  try {
    const { stdout } = run(s);
    assert.match(stdout, new RegExp(`keywords=${enc('Brand Strategist new grad')}&location=${enc('Austin, TX')}&f_E=2`));
    assert.doesNotMatch(stdout, /f_E=1/);
  } finally {
    s.cleanup();
  }
});

// M-001-S12-cdel
test('M-001-S12-cdel a policy-government student gets a USAJOBS item and the site-less preset tips tagged upcoming, with no network request', () => {
  const s = setup({ presets: ['policy-government'], archetypes: ['Policy Analyst'] });
  try {
    const r = run(s);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /network request attempted/);
    const { blocks, upcoming } = parse(r.stdout);
    const usajobs = blocks.find((b) => /USAJOBS/.test(b));
    assert.ok(usajobs, r.stdout);
    assert.match(usajobs, /\(recommended\b/);
    for (const tip of ['Think tank pages', 'Idealist']) {
      assert.ok(upcoming.split('\n').some((l) => l.includes(tip) && /\(upcoming\)/.test(l)), `${tip} is tagged (upcoming)\n${upcoming}`);
    }
    assert.ok(!blocks.some((b) => /Think tank pages|Idealist/.test(b)), 'tips are not numbered items');
  } finally {
    s.cleanup();
  }
});

test('extra check: a student whose presets lack policy-government gets no USAJOBS item', () => {
  const s = setup({ presets: ['byo-employer-list'] });
  try {
    const { blocks } = parse(run(s).stdout);
    assert.ok(blocks.length > 0);
    assert.ok(!blocks.some((b) => /USAJOBS/.test(b)));
  } finally {
    s.cleanup();
  }
});
