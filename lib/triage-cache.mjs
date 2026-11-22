// Job-text hash per posting, so a posting already judged is never sent to the model again while its text is unchanged
// (lever T1). The cache keeps the last verdict line, so an unchanged posting that comes back untriaged gets that verdict
// back with no call; a changed text is sent again. data/triage-cache.tsv sits beside the sidecar rather than in it,
// because the sidecar's columns are a schema other steps read.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readTsv, writeTsvAtomic } from './tsv.mjs';
import { withLock } from './dir-lock.mjs';
import { urlKey } from './url-key.mjs';

export const CACHE_FILE = 'triage-cache.tsv';
const HEADER = ['url_key', 'hash', 'date', 'verdict'];

export const textHash = (text) => createHash('sha256').update(String(text ?? '').replace(/\s+/g, ' ').trim()).digest('hex');

// Triage cache rows keyed by url_key.
export async function loadCache(dataDir) {
  const { rows } = await readTsv(join(dataDir, CACHE_FILE));
  return new Map(rows.map((r) => [r.url_key, r]));
}

// 'new' (never judged), 'unchanged' (same text, verdict reusable) or 'changed' (send again).
export function status(cache, url, text) {
  const prev = cache.get(urlKey(url) ?? url);
  if (!prev) return { state: 'new', verdict: null };
  return prev.hash === textHash(text) && prev.verdict ? { state: 'unchanged', verdict: prev.verdict } : { state: 'changed', verdict: null };
}

// entries: [{ url, text, verdict }]
export async function record(dataDir, entries, date) {
  if (!entries.length) return;
  const file = join(dataDir, CACHE_FILE);
  await withLock(file, async () => {
    const cache = await loadCache(dataDir);
    for (const e of entries) cache.set(urlKey(e.url) ?? e.url, { url_key: urlKey(e.url) ?? e.url, hash: textHash(e.text), date, verdict: e.verdict ?? '' });
    writeTsvAtomic(file, HEADER, [...cache.values()]);
  });
}
