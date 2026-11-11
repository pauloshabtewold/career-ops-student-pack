// Structure of interview/interview.md: Parts A to D, one numbered batch per Part, EEO rules, ordering inside Part B and D.
// Assumed layout: each Part is a '## Part X: ...' section; a batch is a run of lines starting '1. ', '2. ', ... and an item
// runs until the next numbered line or heading. The what-it-does line is not matched by label: an item must carry prose
// beyond its marker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const md = readFileSync(join(PACK_ROOT, 'interview', 'interview.md'), 'utf8');
const readme = readFileSync(join(PACK_ROOT, 'README.md'), 'utf8');

const HEADINGS = ['## Part A: sign-ins', '## Part B: your job queue', '## Part C: application profile', '## Part D: schedule and switches'];
const section = (heading) => {
  const start = md.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const next = md.indexOf('\n## ', start + heading.length + 2);
  return md.slice(start, next < 0 ? undefined : next);
};

// Items of the first numbered batch in a section (numbers 1, 2, 3 ... without a restart).
function firstBatch(text) {
  const lines = text.split('\n');
  const items = [];
  let want = 1;
  for (const line of lines) {
    const m = /^\s{0,3}(\d+)\.\s+(.*)$/.exec(line);
    if (m && Number(m[1]) === want) {
      items.push(line);
      want += 1;
    } else if (m && Number(m[1]) === 1 && items.length) {
      break;
    } else if (items.length && !m && !/^#{1,6}\s/.test(line)) {
      items[items.length - 1] += `\n${line}`;
    } else if (items.length && /^#{1,6}\s/.test(line)) {
      break;
    }
  }
  return items;
}

// M-003-S1-cdel
test('M-003-S1-cdel interview.md has the Part A then B then C then D headings in that order and no Phase heading', () => {
  const at = HEADINGS.map((h) => md.search(new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')));
  assert.ok(at.every((i) => i >= 0), `all four headings present: ${at.join(',')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'headings in order A, B, C, D');
  assert.doesNotMatch(md, /^## Phase\b/m);
  const opening = md.split(/^## /m)[0];
  for (const trigger of ['"set me up"', '"personalize"', '"redo my setup"']) assert.ok(opening.includes(trigger), `opening keeps ${trigger}`);
});

// M-003-S2-cdel
test('M-003-S2-cdel each Part holds a numbered batch whose items carry a (recommended) reason or a personal no-default marker, plus the reply rules', () => {
  for (const h of HEADINGS) {
    const items = firstBatch(section(h));
    assert.ok(items.length >= 2, `${h}: numbered batch of at least 2 items, got ${items.length}`);
    for (const item of items) {
      assert.match(item, /\(recommended\b[^)]*\)|personal, no default|\boptional\b|no account needed/i, `${h}: item has a marker: ${item.split('\n')[0]}`);
      const prose = item.replace(/\(recommended[^)]*\)|personal, no default/gi, '').replace(/^\s*\d+\.\s*/, '').trim();
      assert.ok(prose.length >= 25, `${h}: item says what it does: ${item.split('\n')[0]}`);
    }
  }
  const batchesWithRecommended = HEADINGS.filter((h) => /\(recommended\b/.test(section(h)));
  assert.deepEqual(batchesWithRecommended, HEADINGS, 'every Part offers at least one recommended default');
  assert.ok(md.includes('all recommended'), 'reply rule: all recommended');
  assert.match(md, /["'`]ok["'`]/, 'reply rule: ok');
  assert.ok(md.includes('3: no, 5: 9am'), 'reply rule: 3: no, 5: 9am');
  assert.match(md, /3: no, 5: 9am[^\n]*(only|just)|(only|just)[^\n]*3: no, 5: 9am/i, 'named items only change');
});

// M-003-S3-cdel
test('M-003-S3-cdel Part C EEO items carry no recommended value and say all recommended does not cover them and decline stays decline', () => {
  const partC = section(HEADINGS[2]);
  const words = [/gender/i, /race/i, /hispanic/i, /veteran/i, /disab/i, /pronoun/i, /sexual orientation/i, /transgender/i];
  for (const w of words) {
    const lines = partC.split('\n').filter((l) => w.test(l));
    assert.ok(lines.length >= 1, `Part C mentions ${w}`);
    for (const l of lines) assert.doesNotMatch(l, /\(recommended/i, `no recommended value on: ${l}`);
  }
  assert.ok(partC.includes('decline to self-identify'), 'decline shown as decline to self-identify');
  assert.match(partC, /all recommended[^.\n]*(does not|doesn't|do not|not)[^.\n]*(cover|include|apply)/i, 'all recommended does not cover EEO');
  assert.match(partC, /(once|one time)[^.\n]*same reply|same reply[^.\n]*once/i, 'missing ones asked once in the same reply');
  assert.match(partC, /decline/);
});

// M-003-S4-cdel
test('M-003-S4-cdel no coverage.mjs, preset-portals.mjs, board count or company-type question appears before the Part B first-run --queue step', () => {
  const queueAt = md.indexOf('first-run.mjs --queue');
  assert.ok(queueAt > md.indexOf(HEADINGS[1]), 'Part B names first-run.mjs --queue');
  const before = md.slice(0, queueAt);
  assert.ok(!before.includes('coverage.mjs'), 'no coverage.mjs before the queue step');
  assert.ok(!before.includes('preset-portals.mjs'), 'no preset-portals.mjs before the queue step');
  assert.doesNotMatch(before, /\b\d+\s+(job\s+)?boards?\b/i, 'no board count');
  assert.doesNotMatch(before, /company[- ]type|type of compan|kind of compan|what (kind|type) of employers/i, 'no company-type question');
});

// M-003-S5-cdel
test('M-003-S5-cdel Part D orders disclaimer, disclosures, switch items, schedule install, schedule verify, list-only triage, rank-queue top 10, then the commands guide', () => {
  const partD = section(HEADINGS[3]);
  const paragraph = (readme.split(/^## Disclaimer[ \t]*$/m)[1] ?? '').split(/\n\s*\n/).map((p) => p.trim()).find(Boolean) ?? '';
  assert.ok(paragraph.length > 50, 'README disclaimer found');
  const batchStart = partD.search(/^\s{0,3}1\.\s/m);
  const steps = [
    ['disclaimer', partD.indexOf(paragraph)],
    ['LinkedIn disclosure', partD.indexOf('LinkedIn outreach.')],
    ['Handshake disclosure', partD.search(/^Handshake\. /m)],
    ['switch batch', batchStart],
    ['schedule install', partD.indexOf('schedule.mjs install', Math.max(batchStart, 0))],
    ['schedule verify', partD.indexOf('schedule.mjs verify')],
    ['list-only triage', partD.indexOf('first-run.mjs --list-only')],
    ['rank-queue top 10', partD.indexOf('rank-queue.mjs --n 10')],
    ['commands guide', partD.indexOf('docs/commands.md')],
  ];
  for (const [name, at] of steps) assert.ok(at >= 0, `Part D names ${name}`);
  const positions = steps.map(([, at]) => at);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, steps.map(([n, a]) => `${n}@${a}`).join(' '));
  assert.equal(new Set(positions).size, positions.length, 'distinct positions');
});

// M-003-S21-cdel
test('M-003-S21-cdel Part A runs inbox-pass.mjs --check with the session agent and the Part D inbox item quotes a token figure and its recommended-only conditions', () => {
  const partA = section(HEADINGS[0]);
  assert.match(partA, /node student\/scripts\/inbox-pass\.mjs --check --agent (<claude\|codex>|claude|codex)/);
  assert.ok(/codex/.test(partA) && /claude/.test(partA), 'agent chosen by the session: both values named');
  const partD = section(HEADINGS[3]);
  const item = firstBatch(partD).find((i) => /inbox pass/i.test(i));
  assert.ok(item, 'Part D batch has an inbox pass item');
  assert.match(item, /\d[\d,.]*\s*[kKmM]?\s*tokens/, 'per-run token figure quoted');
  assert.ok(item.includes('usage-cost.md') || /per[- ]run/i.test(item), 'figure is the per-run one');
  assert.match(item, /recommended/i);
  assert.match(item, /check/i, 'condition: Part A check passed');
  assert.match(item, /manual/i, 'condition: automation is not manual');
  assert.match(item, /connector/i, 'condition: mail path is connector');
  assert.match(item, /\boff\b/i, 'shown off otherwise');
});

test('Part C has eight EEO items, none with a recommended value, including sexual orientation and transgender', () => {
  const partC = section(HEADINGS[2]);
  assert.match(partC, /The eight EEO questions/);
  const items = partC.split('\n').filter((l) => /^(9|1[0-6])\. /.test(l) && /no default/.test(l));
  assert.equal(items.length, 8, items.join('\n'));
  for (const l of items) assert.doesNotMatch(l, /\(recommended/i);
  assert.ok(items.some((l) => /Sexual orientation/.test(l)));
  assert.ok(items.some((l) => /Transgender/.test(l)));
});
