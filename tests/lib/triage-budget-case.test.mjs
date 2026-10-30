import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRoot, runScript } from '../helpers/script-harness.mjs';

const CONFIG = 'automation: scheduled-discovery-plus-triage\nagent: claude\nspend_tier: premium\n';

// M-002-S9 edge: uppercase ALL is a bad value
test('M-002-S9 set ALL and cost All exit 2 naming the value and write nothing', () => {
  const r = makeRoot({ config: CONFIG });
  try {
    const before = readFileSync(r.file('config/student.yml'));
    const set = runScript('triage-budget', ['set', 'ALL', '--confirm'], r);
    assert.equal(set.code, 2, set.stdout + set.stderr);
    assert.match(set.stdout + set.stderr, /ALL/);
    const cost = runScript('triage-budget', ['cost', 'All'], r);
    assert.equal(cost.code, 2, cost.stdout + cost.stderr);
    assert.match(cost.stdout + cost.stderr, /All/);
    assert.deepEqual(readFileSync(r.file('config/student.yml')), before);
  } finally {
    r.cleanup();
  }
});
