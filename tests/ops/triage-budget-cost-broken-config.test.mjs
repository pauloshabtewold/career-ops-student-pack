import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript } from '../helpers/script-harness.mjs';

const BROKEN = 'automation: scheduled-discovery-plus-triage\nagent: claude\nnot_a_real_key: 1\n';

test('cost runs with a broken config and prints the config error as a note; status still fails', () => {
  const r = makeRoot({ config: BROKEN });
  try {
    const cost = runScript('triage-budget', ['cost', '50', '--plan', 'claude-max'], r);
    assert.equal(cost.code, 0, cost.stdout + cost.stderr);
    assert.match(cost.stdout, /estimate/);
    assert.match(cost.stdout, /note: .*not_a_real_key/);
    const status = runScript('triage-budget', ['status'], r);
    assert.equal(status.code, 1);
    assert.match(status.stdout, /not_a_real_key/);
  } finally {
    r.cleanup();
  }
});
