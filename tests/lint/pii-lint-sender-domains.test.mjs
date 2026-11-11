import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../../scripts/pii-lint.mjs';

test('public job-alert sender addresses pass the email scan and other domains still fail', () => {
  for (const address of ['alert@indeed.com', 'alerts@simplify.jobs', 'no-reply@joinhandshake.com', 'no-reply@usajobs.gov', 'noreply@indeedemail.com']) {
    assert.equal(scanText('a.md', `from ${address}`).length, 0, address);
  }
  assert.ok(scanText('a.md', `from ${['someone', 'real-corp.io'].join('@')}`).some((f) => f.rule === 'email'));
});

test('extra check: a personal address at a provider with an allowed role address is still a finding', () => {
  for (const address of [['jane.doe', 'linkedin.com'].join('@'), ['jane.doe', 'indeed.com'].join('@')]) {
    assert.ok(scanText('a.md', `from ${address}`).some((f) => f.rule === 'email'), address);
  }
});
