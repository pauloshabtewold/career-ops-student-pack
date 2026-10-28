// TSV helpers with spreadsheet-formula protection: a cell that starts with = + - or @ would execute
// when a student opens a log or sidecar in a spreadsheet.
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { withLock } from './dir-lock.mjs';

export function escapeCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  s = s.replace(/[\t\r\n]/g, ' ');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l !== '');
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
  return { header, rows };
}

export async function readTsv(file) {
  if (!existsSync(file)) return { header: [], rows: [] };
  return parseTsv(readFileSync(file, 'utf8'));
}

export function serializeTsv(header, rows) {
  const body = rows.map((r) => header.map((h) => escapeCell(r[h])).join('\t'));
  return `${[header.join('\t'), ...body].join('\n')}\n`;
}

export async function appendTsv(file, header, rows, lockOptions) {
  // The lock directory sits beside the file, so the parent must exist before the lock is taken.
  mkdirSync(dirname(file), { recursive: true });
  await withLock(
    file,
    () => {
      if (!existsSync(file)) writeFileSync(file, `${header.join('\t')}\n`);
      const lines = rows.map((r) => header.map((h) => escapeCell(r[h])).join('\t'));
      if (lines.length) appendFileSync(file, `${lines.join('\n')}\n`);
    },
    lockOptions,
  );
}

// Writes a whole file through tmp + rename; callers hold the lock when others may write.
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function writeTsvAtomic(file, header, rows) {
  writeAtomic(file, serializeTsv(header, rows));
}
