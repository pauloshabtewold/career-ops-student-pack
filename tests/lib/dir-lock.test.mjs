import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireLock, withLock, LockTimeoutError } from '../../lib/dir-lock.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pack-lock-'));
  const file = join(dir, 'pipeline.md');
  writeFileSync(file, '# Pipeline\n');
  return { dir, file, lockDir: file + '.lock' };
}
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', '']);
  return r.pid;
}
function stamp(lockDir, owner, file) {
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ token: 'other', started_at: new Date().toISOString(), pipeline: file, ...owner }));
}

// M-001-S3
test('M-001-S3 acquire creates lock dir with owner.json and release removes it', async () => {
  const { dir, file, lockDir } = setup();
  try {
    const handle = await acquireLock(file);
    assert.ok(existsSync(lockDir));
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.equal(typeof owner.token, 'string');
    assert.ok(owner.token.length > 0);
    assert.ok(!Number.isNaN(Date.parse(owner.started_at)));
    await handle.release();
    assert.ok(!existsSync(lockDir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withLock releases even when the callback throws', async () => {
  const { dir, file, lockDir } = setup();
  try {
    await assert.rejects(withLock(file, async () => { throw new Error('boom'); }), /boom/);
    assert.ok(!existsSync(lockDir));
    const r = await withLock(file, async () => 42);
    assert.equal(r, 42);
    assert.ok(!existsSync(lockDir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-001-S4
test('M-001-S4 reclaims a lock whose owner pid is dead', async () => {
  const { dir, file, lockDir } = setup();
  try {
    stamp(lockDir, { pid: deadPid() }, file);
    const handle = await acquireLock(file, { timeoutMs: 3000, retryMs: 20 });
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    await handle.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-001-S4
test('M-001-S4 keeps waiting on a lock whose owner pid is alive, even past staleMs', async () => {
  const { dir, file, lockDir } = setup();
  try {
    stamp(lockDir, { pid: process.pid }, file);
    await assert.rejects(acquireLock(file, { timeoutMs: 300, retryMs: 20, staleMs: 1 }), LockTimeoutError);
    assert.ok(existsSync(lockDir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-001-S5
test('M-001-S5 live holder past timeoutMs throws LockTimeoutError with lockDir', async () => {
  const { dir, file, lockDir } = setup();
  try {
    const holder = await acquireLock(file);
    let err;
    try {
      await acquireLock(file, { timeoutMs: 200, retryMs: 20 });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof LockTimeoutError);
    assert.equal(err.lockDir, lockDir);
    await holder.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable and pid-less owner stamps are reclaimed by age after the ownerless grace', async () => {
  for (const content of ['not json {{{', '{}']) {
    const { dir, file, lockDir } = setup();
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), content);
      const handle = await acquireLock(file, { timeoutMs: 6000, retryMs: 50, staleMs: 1 });
      await handle.release();
      assert.ok(!existsSync(lockDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
