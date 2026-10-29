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
test('M-002-S2 disclaimer precedes the LinkedIn outreach disclosure, the switch questions and the Phase 6 sign-in step', () => {
  const at = interview.indexOf(disclaimer);
  const linkedin = interview.indexOf('LinkedIn outreach.');
  const firstSwitch = interview.indexOf('- Outreach:');
  const signIn = interview.indexOf('Sign-in order');
  assert.ok(at >= 0, 'disclaimer present');
  assert.ok(linkedin > at, 'before LinkedIn outreach disclosure');
  assert.ok(firstSwitch > at, 'before switch questions');
  assert.ok(signIn > at, 'before Phase 6 sign-in step');
  assert.ok(at > interview.indexOf('## Phase 4'), 'inside Phase 4');
});

// M-002-S3
test('M-002-S3 interview tells the agent to read the disclaimer once and not repeat it', () => {
  assert.ok(
    interview.includes('Before the disclosures, read this disclaimer once, word for word. Do not repeat it later in the interview.'),
  );
});

// M-002-S4
test('M-002-S4 Phase 4 still asks the outreach, handshake, submission and LinkedIn tier switches', () => {
  const phase4 = interview.split(/^## Phase 4/m)[1].split(/^## Phase 5/m)[0];
  assert.match(phase4, /^- Outreach: `on`, `drafts` or `off`\./m);
  assert.match(phase4, /^- Handshake: `on` or `off`\./m);
  assert.match(phase4, /^- Who presses submit on applications: `user` \(default\) or `agent`\./m);
  assert.match(phase4, /^- LinkedIn account tier: `free` or `premium`\./m);
});
