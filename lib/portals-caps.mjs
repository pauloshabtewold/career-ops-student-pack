// career-ops 1.39.0 refuses a board response over 10 MB unless the portals.yml entry sets max_response_mb. A student
// who copied a preset's seeds before the pack carried that key keeps the old entry and would lose the board on
// upgrade, so update adds the key to entries whose careers_url matches a capped preset seed.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadPreset } from './presets.mjs';

const urlKey = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase();

// careers_url key -> max_response_mb for every capped seed across the pack's presets.
export function presetResponseCaps(packRoot) {
  const ids = readdirSync(join(packRoot, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4));
  const caps = new Map();
  for (const id of ids) {
    for (const e of loadPreset(id).seed_employers) {
      const key = urlKey(e.careers_url);
      if (e.max_response_mb !== undefined) caps.set(key, Math.max(caps.get(key) ?? 0, e.max_response_mb));
    }
  }
  return caps;
}

const parse = (text) => {
  try {
    return yaml.load(text);
  } catch {
    return undefined;
  }
};

// This function adds max_response_mb to enabled tracked_companies entries that match a cap and lack the key. It works by:
// 1. parsing the file to pick the entries to change, so comments and quoting never decide which entries match;
// 2. inserting one line after each matching block-style careers_url line, because a YAML round-trip would drop the
//    comments and cycle markers that scripts/cycle.mjs rewrites;
// 3. parsing the result and keeping it only when every entry equals the original plus the new key, so an entry it
//    cannot place exactly (flow style, a duplicate URL, a URL also used elsewhere in the file) leaves the file as it was.
export function addResponseCaps(text, caps) {
  const unchanged = { text, added: [] };
  const doc = parse(text);
  const entries = Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : [];
  const want = entries.filter((e) => e && typeof e === 'object' && e.enabled !== false && e.max_response_mb === undefined && caps.has(urlKey(e.careers_url)));
  if (!want.length) return unchanged;

  const wantKeys = new Set(want.map((e) => urlKey(e.careers_url)));
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    out.push(line);
    const m = /^(\s*)(- )?careers_url:\s*(["']?)(\S+?)\3\s*$/.exec(line);
    if (!m || !wantKeys.has(urlKey(m[4]))) continue;
    const indent = m[1] + (m[2] ? '  ' : '');
    out.push(`${indent}max_response_mb: ${caps.get(urlKey(m[4]))}`);
  }
  const next = out.join('\n');
  const after = parse(next)?.tracked_companies;
  if (!Array.isArray(after) || after.length !== entries.length) return unchanged;
  const wanted = new Set(want);
  for (const [i, before] of entries.entries()) {
    const expected = wanted.has(before) ? { ...before, max_response_mb: caps.get(urlKey(before.careers_url)) } : before;
    if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(after[i] ?? {}).sort())) return unchanged;
  }
  const { tracked_companies: _a, ...restBefore } = doc;
  const { tracked_companies: _b, ...restAfter } = parse(next);
  if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) return unchanged;
  return { text: next, added: want.map((e) => e.name) };
}
