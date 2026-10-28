import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertRows, lookup, loadSidecar } from '../../lib/sidecar.mjs';

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'pack-side-'));
  return { dir, file: join(dir, 'student-rows.tsv') };
}

// M-001-S9
test('M-001-S9 lookup by a utm-variant URL returns stored src and imported', async () => {
  const { dir, file } = tmpFile();
  try {
    await upsertRows(file, [{ url: 'https://example.com/jobs/1', src: 'list-a', imported: '2026-01-05', extid: '', notes: '' }]);
    const side = await loadSidecar(file);
    const hit = lookup(side, 'https://EXAMPLE.com/jobs/1/?utm_source=x&utm_medium=y#top');
    assert.equal(hit.src, 'list-a');
    assert.equal(hit.imported, '2026-01-05');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first imported date wins on re-upsert', async () => {
  const { dir, file } = tmpFile();
  try {
    await upsertRows(file, [{ url: 'https://example.com/jobs/1', src: 'list-a', imported: '2026-01-05' }]);
    await upsertRows(file, [{ url: 'https://example.com/jobs/1?utm_source=z', src: 'list-a', imported: '2026-02-09' }]);
    const side = await loadSidecar(file);
    assert.equal(lookup(side, 'https://example.com/jobs/1').imported, '2026-01-05');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rows without a usable URL are skipped', async () => {
  const { dir, file } = tmpFile();
  try {
    await upsertRows(file, [
      { url: '', src: 'x', imported: '2026-01-05' },
      { url: 'mailto:someone@example.com', src: 'x', imported: '2026-01-05' },
      { url: 'https://example.com/jobs/2', src: 'ok', imported: '2026-01-06' },
    ]);
    const side = await loadSidecar(file);
    assert.equal(lookup(side, 'https://example.com/jobs/2').src, 'ok');
    assert.ok(!lookup(side, 'mailto:someone@example.com'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
