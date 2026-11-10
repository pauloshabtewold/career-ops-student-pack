import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const readme = readFileSync(join(PACK_ROOT, 'README.md'), 'utf8');
const interview = readFileSync(join(PACK_ROOT, 'interview', 'interview.md'), 'utf8');

// First non-empty paragraph after the '## Disclaimer' heading.
const afterHeading = readme.split(/^## Disclaimer[ \t]*$/m)[1] ?? '';
const disclaimer = afterHeading.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 0) ?? '';

const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

// M-002-S1
test('M-002-S1 interview.md contains the README Disclaimer paragraph verbatim exactly once', () => {
  assert.ok(disclaimer.length > 50, 'README Disclaimer paragraph found');
  assert.equal(count(interview, disclaimer), 1);
});

// M-002-S2
test('M-002-S2 disclaimer precedes the LinkedIn outreach disclosure and the switch questions inside Part D', () => {
  const at = interview.indexOf(disclaimer);
  const linkedin = interview.indexOf('LinkedIn outreach.');
  const firstSwitch = interview.search(/^\d+\. Outreach\./m);
  assert.ok(at >= 0, 'disclaimer present');
  assert.ok(linkedin > at, 'before LinkedIn outreach disclosure');
  assert.ok(firstSwitch > at, 'before switch questions');
  assert.ok(at > interview.indexOf('## Part D'), 'inside Part D');
});

// M-002-S3
test('M-002-S3 interview tells the agent to read the disclaimer once and not repeat it', () => {
  assert.ok(
    interview.includes('Before the disclosures, read this disclaimer once, word for word. Do not repeat it later in the interview.'),
  );
});

// M-002-S4
test('M-002-S4 Part D still asks the outreach, handshake, submission and LinkedIn tier switches', () => {
  const partD = interview.split(/^## Part D: schedule and switches/m)[1];
  assert.match(partD, /^\d+\. Outreach\. .*`on`.*`drafts`/m);
  assert.match(partD, /^\d+\. Handshake pass\. .*`on`.*`off`/m);
  assert.match(partD, /^\d+\. Who presses submit\. .*`user`.*`agent`/m);
  assert.match(partD, /^\d+\. LinkedIn account tier\. .*`free`.*`premium`/m);
});

// M-003-S6-cdel
test('M-003-S6-cdel the README disclaimer appears exactly once and verbatim in interview.md', () => {
  assert.ok(disclaimer.length > 50, 'README Disclaimer paragraph found');
  assert.equal(count(interview, disclaimer), 1);
});
