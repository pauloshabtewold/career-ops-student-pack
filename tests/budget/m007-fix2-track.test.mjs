// N2-5: v0.4 logs say internship or newgrad, rank-queue rows say intern or fulltime; budget.mjs treats them as the same
// track, and the other-track exit names the confirm reply. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, at, shiftDate, row, baseConfig } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const ev = (args, history) => evaluate({ action: 'apply.submit', args, history, config: baseConfig(), session: 's1', now: at(DAY, 15, 0), rng: () => 0.5 });
const submit = (company, track, days) => row({ ts: at(shiftDate(DAY, -days), 12, 0), action: 'apply.submit', target: `ex-${company}-${days}`, company, session: 's0', detail: `track=${track}` });
const seasoned = [submit('Old Example Co', 'intern', 60)];
const args = (track) => ({ target: 'ex-new', company: 'Example Robotics', track, score: 4.2, batch: 1 });

// M-007-fix2-N2-5a
test('M-007-fix2-N2-5a a v0.4 internship row and a new intern submit at one company are the same track', () => {
  assert.equal(ev(args('intern'), [...seasoned, submit('Example Robotics', 'internship', 3)]).status, 'ok');
  assert.equal(ev(args('fulltime'), [...seasoned, submit('Example Robotics', 'newgrad', 3)]).status, 'ok');
});

// M-007-fix2-N2-5b
test('M-007-fix2-N2-5b the other track still needs the user and the line offers the confirm reply', () => {
  const res = ev(args('fulltime'), [...seasoned, submit('Example Robotics', 'internship', 3)]);
  assert.equal(res.status, 'needs-user');
  assert.match(res.reason, /already has track internship/);
  assert.match(res.reason, /I'll record Example Robotics as fulltime, approve\? Type: confirm Example Robotics track fulltime/);
  assert.ok(!res.reason.includes('\n'));
  const confirmed = [...seasoned, submit('Example Robotics', 'internship', 3), row({ ts: at(shiftDate(DAY, -1), 12, 0), action: 'apply.track-confirm', target: 'ex-c', company: 'Example Robotics', session: 's0', detail: 'track=newgrad' })];
  assert.equal(ev(args('fulltime'), confirmed).status, 'ok', 'a legacy newgrad confirm counts for fulltime');
});

// M-007-fix2-N2-5c
test('M-007-fix2-N2-5c modes/apply-loop.md names the confirm reply and the apply.track-confirm log', () => {
  const text = readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8');
  assert.match(text, /Type: confirm <company> track <track>/);
  assert.match(text, /budget\.mjs log apply\.track-confirm --company "<company>" --track <track>/);
});
