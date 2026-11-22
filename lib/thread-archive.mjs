// Outreach conversations kept as plain text, one file per contact: <data>/threads/<name>-<company>.txt. Every send
// (gmail-chrome, a logged LinkedIn message) and every reply read appends its message here with plain code and no model
// call. The files are the student's own data: they stay in the data folder and never enter the pack.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const THREAD_DIR = 'threads';
const SLUG_MAX = 60;

const slugPart = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '') || 'unknown';

// File name for a contact, keyed like the outreach hygiene rules (name plus company, case-insensitive), safe on every OS.
export const threadSlug = (name, company) => `${slugPart(name)}-${slugPart(company)}`;
export const threadFile = (dataDir, name, company) => join(dataDir, THREAD_DIR, `${threadSlug(name, company)}.txt`);

/**
 * Appends one message to the contact's thread. direction is sent or received; channel is linkedin or email. A message
 * already in the file (the same direction, channel and text, read again) is not added twice. Returns the file path.
 */
export function archiveMessage(dataDir, { name, company, direction, channel, text, ts = new Date().toISOString() }) {
  if (!name || !company) throw new Error('thread-archive: name and company are required');
  if (!['sent', 'received'].includes(direction)) throw new Error(`thread-archive: direction must be sent or received, got "${direction}"`);
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const file = threadFile(dataDir, name, company);
  if (!body) return file;
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const mark = `| ${direction} | ${channel} ---\n${body}\n`;
  if (old.includes(mark)) return file;
  mkdirSync(join(dataDir, THREAD_DIR), { recursive: true });
  const head = old ? '' : `# Thread: ${name} at ${company}\n\n`;
  appendFileSync(file, `${head}--- ${ts} ${mark}\n`);
  return file;
}
