import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupAll, copyPack, run, setup, tmp } from './_harness.mjs';

after(cleanupAll);

const USAGE = '--scratch must be a new directory outside the pack and the upstream checkout';

test('M-002-S6 a --scratch under a junction that resolves into the pack exits 2 and creates nothing', () => {
  const pack = copyPack();
  const s = setup({ pack });
  const link = join(tmp('goal-check-link-'), 'link');
  symlinkSync(realpathSync(pack), link, 'junction');
  s.argv[s.argv.indexOf('--scratch') + 1] = join(link, 'via-link', 'work');
  const r = run(s);
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, new RegExp(USAGE));
  assert.ok(!existsSync(join(pack, 'via-link')));
});

test('M-002-S7 a --scratch inside the upstream checkout exits 2 with the usage message and creates nothing', () => {
  const s = setup();
  const scratch = join(s.up.root, 'inner-scratch');
  s.argv[s.argv.indexOf('--scratch') + 1] = scratch;
  const r = run(s);
  assert.equal(r.code, 2, r.stderr);
  assert.ok(r.stderr.includes(USAGE), r.stderr);
  assert.ok(!existsSync(scratch));
});
