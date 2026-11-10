import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../../scripts/pii-lint.mjs';

test('public job-alert sender domains pass the email scan and other domains still fail', () => {
  for (const domain of ['joinhandshake.com', 'simplify.jobs', 'indeed.com', 'indeedemail.com', 'usajobs.gov', 'linkedin.com']) {
    assert.equal(scanText('a.md', `from no-reply@${domain}`).length, 0, domain);
  }
  assert.ok(scanText('a.md', `from ${['someone', 'real-corp.io'].join('@')}`).some((f) => f.rule === 'email'));
});
