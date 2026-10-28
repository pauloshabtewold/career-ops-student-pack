// File helpers local to the plugin. They duplicate small parts of lib/ on purpose: a plugin directory is copied
// verbatim into plugins.local/ and must not reach back into the pack.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SIDECAR_HEADER = ['url_key', 'url', 'src', 'imported', 'extid', 'notes'];
const TRACKING = [/^utm_/i, /^gh_src$/i, /^source$/i, /^ref$/i, /^lever-source$/i];

// Same canonical key as lib/url-key.mjs; a test asserts the two agree.
export function urlKey(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.some((re) => re.test(k)));
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = kept.length ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host.toLowerCase()}${path}${query}`;
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value).replace(/[\t\r\n]/g, ' ');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

// Appends rows under a header written once. Cells are escaped like lib/tsv.mjs so a spreadsheet never runs them.
export async function appendStats(file, header, rows) {
  if (!rows.length) return;
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `${header.join('\t')}\n`);
  appendFileSync(file, `${rows.map((r) => header.map((h) => escapeCell(r[h])).join('\t')).join('\n')}\n`);
}

export function readTsvRows(file) {
  if (!existsSync(file)) return [];
  const [head, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '');
  if (!head) return [];
  const cols = head.split('\t');
  return lines.map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(cols.map((h, i) => [h, cells[i] ?? '']));
  });
}

export function loadSidecarKeys(file) {
  return new Set(readTsvRows(file).map((r) => r.url_key));
}

// Same merge as lib/sidecar.mjs upsertRows: the first imported date wins, so a re-import never makes an old posting look new.
export async function upsertSidecar(file, rows) {
  const byKey = new Map(readTsvRows(file).map((r) => [r.url_key, r]));
  for (const row of rows) {
    const key = urlKey(row.url);
    if (!key) continue;
    const prev = byKey.get(key);
    const merged = { url_key: key, url: row.url, src: '', imported: '', extid: '', notes: '', ...prev };
    for (const f of ['src', 'extid', 'notes']) if (row[f]) merged[f] = row[f];
    if (!prev?.imported && row.imported) merged.imported = row.imported;
    byKey.set(key, merged);
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = [...byKey.values()].map((r) => SIDECAR_HEADER.map((h) => escapeCell(r[h])).join('\t'));
  writeFileSync(tmp, `${[SIDECAR_HEADER.join('\t'), ...body].join('\n')}\n`);
  renameSync(tmp, file);
}
