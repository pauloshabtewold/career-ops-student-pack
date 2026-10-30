import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withTempDir } from '../../lib/temp-dir.mjs';

// normal: returns fn's value and removes the directory
test('M-003-S3 withTempDir returns the value and removes the directory', () => {
  let seen;
  const result = withTempDir('m003-sync-', (dir) => {
    seen = dir;
    assert.ok(existsSync(dir));
    return 42;
  });
  assert.equal(result, 42);
  assert.ok(seen);
  assert.equal(existsSync(seen), false);
});

// edge: async fn keeps the directory until it settles
test('M-003-S6 withTempDir keeps the directory while an async fn is pending', async () => {
  let seen;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const pending = withTempDir('m003-async-', async (dir) => {
    seen = dir;
    await gate;
    return 'done';
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(seen);
  assert.ok(existsSync(seen), 'directory exists while pending');
  release();
  assert.equal(await pending, 'done');
  assert.equal(existsSync(seen), false);
});

// error: removes the directory and rethrows the same error
test('M-003-S8 withTempDir removes the directory and rethrows when fn throws or rejects', async () => {
  const boom = new Error('sync-boom');
  let seen;
  assert.throws(
    () =>
      withTempDir('m003-throw-', (dir) => {
        seen = dir;
        throw boom;
      }),
    (err) => err === boom,
  );
  assert.ok(seen);
  assert.equal(existsSync(seen), false);

  const boom2 = new Error('async-boom');
  let seen2;
  await assert.rejects(
    withTempDir('m003-reject-', async (dir) => {
      seen2 = dir;
      throw boom2;
    }),
    (err) => err === boom2,
  );
  assert.ok(seen2);
  assert.equal(existsSync(seen2), false);
});
