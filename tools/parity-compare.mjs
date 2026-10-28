// Stage comparison for the parity harness. Everything returned or rendered here is a count or a verdict:
// row text never leaves this module, so a report built from it cannot carry URLs, companies or titles.
import { urlKey } from '../lib/url-key.mjs';

function flatten(value, prefix, out) {
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (value && typeof value === 'object') for (const k of Object.keys(value).sort()) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  else out.push(`${prefix}=${JSON.stringify(value)}`);
}

// A pipeline note such as "| note: b=2; a=1" is compared as a set of tokens.
function normalizeNote(line) {
  const at = line.indexOf('| note:');
  if (at === -1) return line;
  const head = line.slice(0, at + '| note:'.length);
  const tokens = line
    .slice(at + '| note:'.length)
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return `${head} ${tokens.join('; ')}`;
}

// Returns sorted normalized rows. Markdown rows (lines beginning "- ") are keyed by their section heading, so a
// row that moved between sections is one missing plus one added while order inside a section is ignored.
// Output with no such rows (for example TRIAGE lines) falls back to every non-heading line.
export function normalizeRows(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const out = [];
      flatten(JSON.parse(trimmed), '', out);
      return out.sort();
    } catch {
      // Not JSON after all; compare as lines.
    }
  }
  const entries = [];
  let section = '';
  for (const raw of trimmed.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/^#{1,6} /.test(line)) {
      section = line;
      continue;
    }
    entries.push({ row: line.startsWith('- '), text: `${section}\u0000${normalizeNote(line)}` });
  }
  const rows = entries.some((e) => e.row) ? entries.filter((e) => e.row) : entries;
  return rows.map((e) => e.text).sort();
}

function countMap(rows) {
  const m = new Map();
  for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}

function diffCounts(a, b) {
  const ma = countMap(a);
  const mb = countMap(b);
  let added = 0;
  let missing = 0;
  for (const [k, n] of mb) added += Math.max(0, n - (ma.get(k) ?? 0));
  for (const [k, n] of ma) missing += Math.max(0, n - (mb.get(k) ?? 0));
  return { added, missing };
}

// explained: number of differences already accounted for by a documented, deliberate change;
// any difference beyond that count is a fail.
export function compareStage(name, baselineOut, packOut, { explained = 0 } = {}) {
  const a = normalizeRows(baselineOut);
  const b = normalizeRows(packOut);
  const { added, missing } = diffCounts(a, b);
  let verdict = 'pass';
  if (added || missing) verdict = added + missing <= explained ? 'explained' : 'fail';
  return { stage: name, baseline_count: a.length, pack_count: b.length, added, missing, verdict };
}

const URL_RE = /https?:\/\/[^\s|"'<>)\]]+/g;
const extractKeys = (text) => new Set((String(text ?? '').match(URL_RE) ?? []).map((u) => urlKey(u)).filter(Boolean));

// Feed churn guard: only a URL seen by both pack fetches and absent from the local output is a mismatch.
// A URL seen by just one pack fetch is list churn, not a defect.
export function compareFeed(packFetchA, packFetchB, localOut) {
  const A = extractKeys(packFetchA);
  const B = extractKeys(packFetchB);
  const L = extractKeys(localOut);
  const both = [...A].filter((k) => B.has(k));
  const mismatches = both.filter((k) => !L.has(k)).length;
  return { mismatches, stage: 'feed', baseline_count: L.size, pack_count: both.length, added: 0, missing: mismatches, verdict: mismatches ? 'fail' : 'pass' };
}

export function overallVerdict(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  return results.some((r) => r.verdict === 'explained') ? 'explained' : 'pass';
}

// meta: { date, upstream, pack }. Stage names come from the fixed stage table, never from input data.
export function formatReport(results, meta = {}) {
  const lines = [
    '# Parity report',
    '',
    `Date: ${meta.date ?? 'unknown'}`,
    `Upstream version: ${meta.upstream ?? 'unknown'}`,
    `Pack commit: ${meta.pack ?? 'unknown'}`,
    '',
    '| Stage | Baseline | Pack | Added | Missing | Verdict |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.stage} | ${r.baseline_count} | ${r.pack_count} | ${r.added} | ${r.missing} | ${r.verdict} |`),
    '',
    `Overall: ${overallVerdict(results)}`,
    '',
  ];
  return lines.join('\n');
}

export const NOTES = Object.freeze({});
export function exitNote(side, exit) {
  return '';
}
export const stageError = (name, note) => ({});
export const skippedStage = (name, note) => ({});
export function normalizeCycle(text) {
  return null;
}
export function compareCycle(name, baselineText, packText) {
  return {};
}
export function compareRankQueue(name, baselineText, packText) {
  return {};
}
export function compareFailAudit(name, baselineText, packText, { keywords }) {
  return {};
}
export function mergeAllowance(stdout) {
  return -1;
}
export const REPORT_HEADER = '';
