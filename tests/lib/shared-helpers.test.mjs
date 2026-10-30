import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as text from '../../lib/text.mjs';
import * as clock from '../../lib/clock.mjs';

// M-002-S1
test('M-002-S1 stepErrorText takes the first non-empty line of stderr, then stdout, then message', () => {
  assert.equal(text.stepErrorText({ stderr: '\n  boom here \nsecond', stdout: 'out', message: 'msg' }), 'boom here');
  assert.equal(text.stepErrorText({ stderr: '', stdout: '\n\nout line\nmore', message: 'msg' }), 'out line');
  assert.equal(text.stepErrorText({ stderr: undefined, stdout: '', message: 'only message' }), 'only message');
  assert.equal(text.stepErrorText(new Error('plain error')), 'plain error');
});

// M-002-S4
test('M-002-S4 stepErrorText returns failed when stderr, stdout and message are all empty', () => {
  assert.equal(text.stepErrorText({}), 'failed');
  assert.equal(text.stepErrorText({ stderr: '', stdout: '', message: '' }), 'failed');
  assert.equal(text.stepErrorText({ stderr: '  \n ', stdout: '', message: '' }), 'failed');
});

// M-002-S2
test('M-002-S2 ISO_DATE and isIsoDate accept 2026-10-30; isRealDate accepts 2024-02-29', () => {
  assert.ok(clock.ISO_DATE instanceof RegExp);
  assert.ok(clock.ISO_DATE.test('2026-10-30'));
  assert.deepEqual(clock.ISO_DATE.exec('2026-10-30').slice(1), ['2026', '10', '30']);
  assert.equal(clock.ISO_DATE.test('2026-1-30'), false);
  assert.equal(clock.ISO_DATE.test('x2026-10-30'), false);
  assert.equal(clock.ISO_DATE.test('2026-10-30\n'), false);
  assert.equal(clock.isIsoDate('2026-10-30'), true);
  assert.equal(clock.isIsoDate('10-30-2026'), false);
  assert.equal(clock.isRealDate('2024-02-29'), true);
  assert.equal(clock.isRealDate('2026-10-30'), true);
});

// M-002-S5
test('M-002-S5 2026-02-30 passes isIsoDate by shape and fails isRealDate; isIsoDate rejects non-strings', () => {
  assert.equal(clock.isIsoDate('2026-02-30'), true);
  assert.equal(clock.isRealDate('2026-02-30'), false);
  assert.equal(clock.isRealDate('2025-02-29'), false);
  for (const v of [undefined, null, 20261030, new Date(), {}, ['2026-10-30']]) assert.equal(clock.isIsoDate(v), false);
});
