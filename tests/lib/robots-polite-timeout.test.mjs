// politeFetch bounds each page request so one stalled host cannot hold the queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { politeFetch } from '../../lib/robots.mjs';

test('extra check: a page request that never answers is aborted after timeoutMs', async () => {
  const stalled = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const fetch = politeFetch({ fetch: stalled, checker: { check: async () => ({ allowed: true, crawlDelay: null }) }, sleep: async () => {}, timeoutMs: 30 });
  // AbortSignal.timeout's timer is unref'd, so a ref'd handle keeps the loop alive until the abort fires.
  const keepAlive = setTimeout(() => {}, 10000);
  try {
    await assert.rejects(fetch('https://jobs.example.com/a'), /aborted/);
  } finally {
    clearTimeout(keepAlive);
  }
});
