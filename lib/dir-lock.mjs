// Directory lock compatible with upstream's pipeline lock: '<file>.lock' directory holding owner.json
// {pid, token, started_at, pipeline}. Both sides must exclude each other on data/pipeline.md, and upstream
// exposes no CLI for it, so the on-disk protocol is reimplemented here and pinned by compat.json.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const LOCK_DEFAULTS = Object.freeze({ timeoutMs: 8000, retryMs: 80, staleMs: 30000, ownerlessGraceMs: 1000 });

export class LockTimeoutError extends Error {
  constructor(lockDir, owner) {
    super(`timed out waiting for lock ${lockDir}`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
    this.owner = owner;
  }
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows reports a directory that is mid-create or mid-remove as EPERM or EACCES, so those count as contention like EEXIST.
const isContention = (err) => ['EEXIST', 'EPERM', 'EACCES'].includes(err.code);

// state: ok | missing (no stamp yet) | corrupt (partial write) | unreadable (a transient read error such as EPERM or EBUSY).
function readOwner(lockDir) {
  try {
    return { owner: JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')), state: 'ok' };
  } catch (err) {
    if (err.code === 'ENOENT') return { owner: null, state: 'missing' };
    return { owner: null, state: err instanceof SyntaxError ? 'corrupt' : 'unreadable' };
  }
}

function ageMs(path, now) {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// Liveness of the owner pid decides first. A stamp that cannot be inspected counts as live, so a holder past the
// stale age is never reclaimed because of one failed read; directory age decides only when the stamp has no pid.
function isStale(lockDir, opts, now) {
  const { owner, state } = readOwner(lockDir);
  if (state === 'unreadable') return false;
  if (owner && Number.isInteger(owner.pid)) return !isPidAlive(owner.pid);
  const age = ageMs(lockDir, now);
  return state === 'missing' ? age >= opts.ownerlessGraceMs : age >= opts.staleMs;
}

// Reclaim is serialized behind '<file>.lock.recover' so two waiters never both delete a fresh lock.
function tryReclaim(lockDir, opts, now) {
  const guard = `${lockDir}.recover`;
  try {
    mkdirSync(guard);
  } catch (err) {
    if (!isContention(err)) throw err;
    if (ageMs(guard, now) >= opts.staleMs) rmSync(guard, { recursive: true, force: true });
    return false;
  }
  try {
    if (!isStale(lockDir, opts, now)) return false;
    rmSync(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return true;
  } finally {
    rmSync(guard, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export async function acquireLock(file, options = {}) {
  const opts = { ...LOCK_DEFAULTS, ...options };
  const lockDir = `${file}.lock`;
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
    } catch (err) {
      if (!isContention(err)) throw err;
      if (tryReclaim(lockDir, opts, Date.now())) continue;
      if (Date.now() - started >= opts.timeoutMs) throw new LockTimeoutError(lockDir, readOwner(lockDir).owner);
      await sleep(opts.retryMs);
      continue;
    }
    return stampOwner(lockDir, file);
  }
}

function stampOwner(lockDir, file) {
  const token = randomUUID();
  const owner = { pid: process.pid, token, started_at: new Date().toISOString(), pipeline: file };
  try {
    writeFileSync(join(lockDir, 'owner.json'), `${JSON.stringify(owner)}\n`);
  } catch (err) {
    // A lock directory without a stamp would block other waiters until the ownerless grace expires.
    rmSync(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    throw err;
  }
  return { lockDir, token, release: () => releaseLock(lockDir, token) };
}

// Only the holder deletes: a reclaimed-and-retaken lock carries a different token.
export function releaseLock(lockDir, token) {
  const { owner } = readOwner(lockDir);
  if (owner && owner.token !== token) return false;
  // rmSync retries EPERM and EBUSY, which Windows raises while antivirus or indexers hold a handle.
  rmSync(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return true;
}

export async function withLock(file, fn, options = {}) {
  const lock = await acquireLock(file, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
