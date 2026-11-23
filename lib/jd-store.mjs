// Saves the guarded job text of each applied posting next to the tracker, so a later interview or follow-up can read
// what the student applied to after the posting is taken down.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { urlKey } from './url-key.mjs';

export const JD_DIR = 'jds';

// A short stable file name from the canonical url key.
export function jdFileName(url) {
  const key = urlKey(url) ?? String(url);
  return `${createHash('sha256').update(key).digest('hex').slice(0, 16)}.txt`;
}

// The saved job text of a posting (data/jds/<key>.txt), or '' when none was saved.
export function load(dataDir, url) {
  const file = join(dataDir, JD_DIR, jdFileName(url));
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

// Writes data/jds/<key>.txt and returns the note token jd=<file>; equal text leaves the file untouched, and empty text
// never replaces saved text (a later run that found no text keeps what an earlier one saved).
export function save(dataDir, url, guardedText) {
  const name = jdFileName(url);
  const dir = join(dataDir, JD_DIR);
  const file = join(dir, name);
  const text = String(guardedText ?? '');
  const saved = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (saved !== text && !(saved?.trim() && !text.trim())) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
  }
  return `jd=${name}`;
}
