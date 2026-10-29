// Runbook asserts for docs/maintenance.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const doc = readFileSync(join(PACK_ROOT, 'docs', 'maintenance.md'), 'utf8');

function sections(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^## (.*)$/);
    if (m) {
      cur = m[1].trim();
      out[cur] = '';
    } else if (cur !== null) out[cur] += `${line}\n`;
  }
  return out;
}
const secs = sections(doc);
const find = (prefix) => {
  const k = Object.keys(secs).find((h) => h.startsWith(prefix));
  assert.ok(k, `missing section "${prefix}"`);
  return secs[k];
};
const mustContain = (text, words, where) => {
  for (const w of words) assert.ok(text.includes(w), `${where} lacks "${w}"`);
};

// M-005-S13
test('M-005-S13 maintenance.md names release.yml and mark-unmaintained.yml', () => {
  mustContain(doc, ['release.yml', 'mark-unmaintained.yml'], 'docs/maintenance.md');
});

// M-005-S14
test('M-005-S14 maintenance.md has the exact ## Releases heading', () => {
  assert.ok(/^## Releases$/m.test(doc), 'heading line "## Releases"');
  const src = readFileSync(join(PACK_ROOT, 'scripts', 'check-safety-tag.mjs'), 'utf8');
  const thrown = [...src.matchAll(/new NoBaselineError\(([^;]*)\)/g)].map((m) => m[1]);
  assert.ok(thrown.length > 0, 'check-safety-tag.mjs throws NoBaselineError with a message');
  for (const msg of thrown) {
    assert.ok(msg.includes('docs/maintenance.md') && msg.includes('Releases'), `NoBaselineError message points to docs/maintenance.md Releases: ${msg}`);
  }
});

// M-005-S15
test('M-005-S15 Safety tags section states the first v tag baseline', () => {
  mustContain(find('Safety tags'), ['first v tag'], 'Safety tags section');
});

// M-005-S16
test('M-005-S16 maintenance.md links upstream/README.md', () => {
  assert.match(doc, /\]\([^)]*upstream\/README\.md[^)]*\)/);
});

// M-005-S17
test('M-005-S17 Releases section explains withheld subjects and the pii-lint stop', () => {
  mustContain(secs.Releases ?? '', ['pii-lint', 'subject withheld', 'workflow_dispatch', 'nothing needs rewording'], 'Releases section');
});

// M-005-S18
test('M-005-S18 Releases section covers a gate failure with rerun', () => {
  mustContain(secs.Releases ?? '', ['CI is not green', 'rerun'], 'Releases section');
});

// M-005-S19
test('M-005-S19 Preset audits section states the 60-day maintainer-comment rule', () => {
  mustContain(find('Preset audits'), ['60 days', 'maintainer comment'], 'Preset audits section');
});

test('M-005-S13 maintenance.md has no em dash or curly quotes', () => {
  const bad = [8212, 8216, 8217, 8220, 8221].map((c) => String.fromCharCode(c));
  for (const b of bad) assert.ok(!doc.includes(b), `contains U+${b.charCodeAt(0).toString(16)}`);
});
