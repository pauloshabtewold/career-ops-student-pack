// lib/clean-text.mjs clean: straight quotes, no em or en dashes, and code and URLs left exactly as written. The
// typography characters are built from code points so this file passes scripts/lint-files.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../../lib/clean-text.mjs';

const ch = (code) => String.fromCodePoint(code);
const [EM, EN, LS, RS, LD, RD] = [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d].map(ch);

test('curly single and double quotes become straight quotes', () => {
  assert.equal(clean(`The team${RS}s ${LD}fast${RD} tool and ${LS}quoted${RS} text.`), 'The team\'s "fast" tool and \'quoted\' text.');
});

test('an em or en dash between words becomes a comma and between digits a hyphen', () => {
  assert.equal(clean(`I built a tool ${EM} it shipped.`), 'I built a tool, it shipped.');
  assert.equal(clean(`I built a tool${EN}it shipped.`), 'I built a tool, it shipped.');
  assert.equal(clean(`Years 2025 ${EN} 2026, pages 3${EM}5.`), 'Years 2025-2026, pages 3-5.');
  assert.ok(!new RegExp(`[${EM}${EN}${LS}${RS}${LD}${RD}]`).test(clean(`a ${EM} b ${LD}c${RD}`)));
});

test('URLs and code spans are untouched, even when they hold dashes, quotes, double spaces or a lowercase sentence start', () => {
  const url = `https://example.com/jobs/a--b_c/Intern?q=1&ref=x${EN}y#top`;
  const span = `\`node scripts/cover.mjs --posting ${LD}a  b${RD}. then\``;
  const fence = '```\n  indented  line\n. lower\n```';
  const out = clean(`See ${url} and run ${span} now ${EM} done.\n${fence}`);
  assert.ok(out.includes(url), out);
  assert.ok(out.includes(span), out);
  assert.ok(out.includes(fence), out);
  assert.ok(out.includes(' now, done.'), 'text outside code is still cleaned');
});
