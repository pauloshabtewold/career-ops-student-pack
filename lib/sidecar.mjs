// URL-keyed sidecar for note tokens (src, imported, extid) that upstream's ingest sanitizer drops.
import { existsSync } from 'node:fs';
import { readTsv, writeTsvAtomic } from './tsv.mjs';
import { withLock } from './dir-lock.mjs';
import { urlKey } from './url-key.mjs';

export const SIDECAR_HEADER = Object.freeze(['url_key', 'url', 'src', 'imported', 'extid', 'notes']);

export async function loadSidecar(file) {
  const byKey = new Map();
  if (existsSync(file)) for (const r of (await readTsv(file)).rows) byKey.set(r.url_key, r);
  return { byKey };
}

export function lookup(sidecar, url) {
  const key = urlKey(url);
  return key ? sidecar.byKey.get(key) ?? null : null;
}

// The first imported date wins: a re-import must not make an old posting look new to the ranker.
export async function upsertRows(file, rows, lockOptions) {
  return withLock(
    file,
    async () => {
      const { byKey } = await loadSidecar(file);
      let added = 0;
      for (const row of rows) {
        const key = urlKey(row.url);
        if (!key) continue;
        const prev = byKey.get(key);
        const merged = { url_key: key, url: row.url, src: '', imported: '', extid: '', notes: '', ...prev };
        for (const f of ['src', 'extid', 'notes']) if (row[f]) merged[f] = row[f];
        if (!prev?.imported && row.imported) merged.imported = row.imported;
        if (!prev) added++;
        byKey.set(key, merged);
      }
      writeTsvAtomic(file, [...SIDECAR_HEADER], [...byKey.values()]);
      return { added, total: byKey.size };
    },
    lockOptions,
  );
}
