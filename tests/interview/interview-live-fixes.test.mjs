// Fixes from a live run: Part headings render as headings, the queue build is several short commands, the Playwright MCP
// warning is not a blocker, Part D asks nothing extra before the guide, and the top list says "up to 10".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const md = readFileSync(join(PACK_ROOT, 'interview', 'interview.md'), 'utf8');
const partB = md.slice(md.indexOf('\n## Part B'), md.indexOf('\n## Part C'));
const partD = md.slice(md.indexOf('\n## Part D'));

test('the interview tells the agent to open each Part with its markdown heading', () => {
  assert.match(md, /Open each Part's message with its heading as a markdown heading/);
  assert.match(md, /never as plain text such as "This is Part A of 4"/);
});

test('Part B builds the queue with one --step command at a time and prints the coverage line once', () => {
  for (const step of ['github-lists', 'scan', 'merge-post', 'prefilter+triage', 'view']) assert.ok(partB.includes(`--queue --step ${step}`) || partB.includes(`\`--step ${step}\``), step);
  assert.match(partB, /scan partial/);
  assert.doesNotMatch(partB, /Run `node student\/scripts\/first-run\.mjs --queue`\./);
  assert.match(partB, /Print the coverage line once/);
  assert.match(partB, /Never start any of them in the background/);
});

test('Part D calls the Playwright MCP warning safe to ignore and asks nothing between scoring and the guide', () => {
  assert.match(partD, /Playwright MCP[^.]*safe to ignore/);
  assert.doesNotMatch(partD, /ask before each one/);
  assert.match(partD, /with no question between batches/);
  assert.match(partD, /top picks \(up to 10\)/);
  assert.match(partD, /In the same message as the top picks, show the guide with no question first/);
});

test('Part C recommends a start date that follows the track: next summer term for an internship, the month after graduation for new grad', () => {
  const partC = md.slice(md.indexOf('\n## Part C'), md.indexOf('\n## Part D'));
  const item = partC.split('\n').find((l) => l.startsWith('4. Start date.'));
  assert.match(item, /internship or co-op track, the start month of the next Summer term in `data\/student-cycle\.json` \(`2027-06` for a student who graduates 2028-05/);
  assert.match(item, /new-grad track, the month after graduation \(`2028-06`/);
  assert.doesNotMatch(item, /\(recommended\) the month after graduation as/);
});
