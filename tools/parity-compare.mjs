// Stage comparison for the parity harness. Everything returned or rendered here is a count or a verdict:
// row text never leaves this module, so a report built from it cannot carry URLs, companies or titles.
import { companyKey } from '../lib/company-key.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { urlKey } from '../lib/url-key.mjs';
import { reasonPredicate } from '../scripts/fail-audit.mjs';

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

// Note vocabulary, a closed set: a note never carries stage output, stderr or a path, only these strings and exit-code integers.
export const NOTES = Object.freeze({
  baselineMissing: 'baseline script missing',
  packMissing: 'pack script missing',
  baselineMalformed: 'malformed baseline output',
  packMalformed: 'malformed pack output',
  dependsOnFailed: 'depends on a failed stage',
  noTsv: 'no TSV input',
  zeroInput: 'no input rows on either side',
});

const code = (n) => (Number.isInteger(n) ? n : 1);

// side is 'baseline' or 'pack' with an exit code, or 'both' with a [baseline, pack] pair.
export function exitNote(side, exit) {
  if (side === 'both') return `both exit ${code(exit[0])}/${code(exit[1])}`;
  return `${side === 'pack' ? 'pack' : 'baseline'} exit ${code(exit)}`;
}

const noCounts = (name, verdict, note) => ({ stage: name, baseline_count: null, pack_count: null, added: null, missing: null, explained: null, verdict, note });
export const stageError = (name, note) => noCounts(name, 'error', note);
export const skippedStage = (name, note) => noCounts(name, 'skipped', note);

// explained is capped at the differences it can cover; the residual (differences minus explained) decides the verdict.
function finish(name, counts, allowance = 0) {
  const total = counts.added + counts.missing;
  const explained = Math.min(allowance, total);
  let verdict = 'pass';
  if (total) verdict = total - explained === 0 ? 'explained' : 'fail';
  return { stage: name, ...counts, explained, verdict };
}

// explained: number of differences already accounted for by a documented, deliberate change;
// any difference beyond that count is a fail.
export function compareStage(name, baselineOut, packOut, { explained = 0 } = {}) {
  const a = normalizeRows(baselineOut);
  const b = normalizeRows(packOut);
  return finish(name, { baseline_count: a.length, pack_count: b.length, ...diffCounts(a, b) }, explained);
}

const sortedInts = (list) => (Array.isArray(list) ? [...list].sort((x, y) => x - y) : []);

// Both cycle schemas carry the same facts under different keys; mapping them onto one subset makes equal content
// pass while a differing term, year or ceiling still shows as one added plus one missing row.
export function normalizeCycle(text) {
  let c;
  try {
    c = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.phase !== 'string') return null;
  const labels = Array.isArray(c.terms) ? c.terms.map((t) => `${t?.name} ${t?.year}`) : Array.isArray(c.internship_terms) ? c.internship_terms.map(String) : null;
  if (!labels) return null;
  return {
    phase: c.phase,
    terms: labels.sort(),
    internship_years: sortedInts(c.internship_years),
    newgrad_years: sortedInts(c.newgrad_years),
    experience_ceiling: c.experience_ceiling_years ?? c.max_experience_ask ?? null,
  };
}

export function compareCycle(name, baselineText, packText) {
  const a = normalizeCycle(baselineText);
  if (!a) return stageError(name, NOTES.baselineMalformed);
  const b = normalizeCycle(packText);
  if (!b) return stageError(name, NOTES.packMalformed);
  return compareStage(name, JSON.stringify(a), JSON.stringify(b));
}

// Picks keyed by urlKey. A pick whose url has no key is dropped and the first of two sharing a key wins.
function parsePicks(text) {
  let picks;
  try {
    picks = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  if (!Array.isArray(picks) || !picks.every((p) => p && typeof p.url === 'string')) return null;
  const byKey = new Map();
  for (const p of picks) {
    const k = urlKey(p.url);
    if (k && !byKey.has(k)) byKey.set(k, p);
  }
  return byKey;
}

function parseBoth(name, baselineText, packText) {
  const a = parsePicks(baselineText);
  if (!a) return { error: stageError(name, NOTES.baselineMalformed) };
  const b = parsePicks(packText);
  if (!b) return { error: stageError(name, NOTES.packMalformed) };
  const added = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k));
  const missing = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k));
  return { a, b, added, missing, counts: { baseline_count: a.size, pack_count: b.size, added: added.length, missing: missing.length } };
}

const companyOf = (p) => (typeof p.company === 'string' ? companyKey(p.company) : '');
const companiesOf = (byKey) => new Set([...byKey.values()].map(companyOf).filter(Boolean));

// Url keys of rows that are Pending in beforeText and not Pending in afterText. The harness passes the pack pipeline
// before and after merge-post, which flags or drops Pending rows by design while the baseline merge is a no-op on empty
// staging. The before text is read after apply-triage ran, so a row apply-triage moved is not in it and is never carried.
export function carriedPending(beforeText, afterText) {
  const pendingKeys = (text) => new Set(sectionRows(parsePipeline(String(text ?? '')), 'Pending').map(({ row }) => urlKey(row.url)).filter(Boolean));
  const after = pendingKeys(afterText);
  return new Set([...pendingKeys(beforeText)].filter((k) => !after.has(k)));
}

// Both sides cap picks per company with different caps and weights, so which posting of a shared company survives
// is a by-design difference. A company on one side only means eligibility differs, which stays residual.
// A baseline pick whose row left the pack Pending section through merge-post (carried) is explained too; a pack-only
// pick never is. A pick that is both carried and of a shared company counts once.
// companyOf uses default keys (no rank.parent_companies or ignore_words), so the compare needs no student config;
// shared-company detection is slightly coarser, which only widens the by-design allowance.
export function compareRankQueue(name, baselineText, packText, { carried = new Set() } = {}) {
  const s = parseBoth(name, baselineText, packText);
  if (s.error) return s.error;
  const ca = companiesOf(s.a);
  const cb = companiesOf(s.b);
  const shared = (p) => {
    const c = companyOf(p);
    return c !== '' && ca.has(c) && cb.has(c);
  };
  const allowance = s.added.filter(shared).length + s.missing.filter((p) => shared(p) || carried.has(urlKey(p.url))).length;
  return finish(name, s.counts, allowance);
}

// The pack audits only rows its reason predicate accepts (config keywords, match mode, exclusion patterns) and never
// mechanical title filters, so baseline-only rows the predicate rejects and title-filter rows differ by design.
// options is the shape auditOptions returns. Pack-only rows and baseline-only rows the predicate accepts stay residual.
// require_triage is not modeled: the pick output carries no triage value, and the baseline applies its own triage rule.
export function compareFailAudit(name, baselineText, packText, options) {
  const s = parseBoth(name, baselineText, packText);
  if (s.error) return s.error;
  const picks = reasonPredicate(options);
  const reasonOf = (p) => String(p.reason ?? '');
  const titleFilter = (p) => /^Title pre-filter/i.test(reasonOf(p));
  const allowance = s.added.filter(titleFilter).length + s.missing.filter((p) => !picks(reasonOf(p))).length;
  return finish(name, s.counts, allowance);
}

// Three pack prefilter rules have no baseline counterpart, so pack-only lines carrying their reason are by design:
// a full-time new-grad title for a student with no new-grad track, a title the preset's early-career pattern does
// not match, and a vice president, chief, professor or general counsel title. A baseline line about a posting the pack dropped for one of them is explained with it (the baseline
// rejected the same posting under another reason or not at all). A baseline-only line whose reason names a
// `rank.intern_only` company followed by full-time is that mirrored knob, which the pack applies at ranking.
const PACK_ONLY_REASONS = ['Title pre-filter: new-grad role and no new-grad track', 'Title pre-filter: not an early-career title', 'Title pre-filter: senior title'];
const verdictUrl = (row) => /^TRIAGE: \w+ \| (\S+) \|/.exec(row.slice(row.indexOf('\u0000') + 1))?.[1] ?? '';

export function comparePrefilter(name, baselineText, packText, { internOnly = [] } = {}) {
  const a = normalizeRows(baselineText);
  const b = normalizeRows(packText);
  const inA = new Set(a);
  const inB = new Set(b);
  const dropped = b.filter((r) => PACK_ONLY_REASONS.some((reason) => r.includes(reason)));
  const droppedUrls = new Set(dropped.map(verdictUrl).filter(Boolean));
  const mirrored = internOnly.map((c) => new RegExp(`Title pre-filter: ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^|]*full-?time`, 'i'));
  const baselineOnly = a.filter((r) => !inB.has(r));
  const allowance = dropped.filter((r) => !inA.has(r)).length + baselineOnly.filter((r) => droppedUrls.has(verdictUrl(r)) || mirrored.some((re) => re.test(r))).length;
  return finish(name, { baseline_count: a.length, pack_count: b.length, ...diffCounts(a, b) }, allowance);
}

const whole = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

// merge-post moves or rewrites a Pending row by design while the baseline merge is a no-op on empty staging.
// Under section-keyed compare a moved or rewritten row is one missing plus one added and a dropped row is one missing.
export function mergeAllowance(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const stats = JSON.parse(line);
      if (stats && typeof stats === 'object' && !Array.isArray(stats)) return 2 * (whole(stats.flagged) + whole(stats.joined)) + whole(stats.dropped);
    } catch {
      // Not the stats line.
    }
  }
  return 0;
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
  if (results.some((r) => r.verdict === 'fail' || r.verdict === 'error')) return 'fail';
  return results.some((r) => r.verdict === 'explained') ? 'explained' : 'pass';
}

export const REPORT_HEADER = '| Stage | Baseline | Pack | Added | Missing | Explained | Verdict |';

const cell = (v) => (v === null || v === undefined ? '-' : v);

// Vacuity made visible: errors and skips carry their fixed note, a pass over zero rows says so.
function warningsOf(results) {
  return results.flatMap((r) => {
    if (r.verdict === 'error' || r.verdict === 'skipped') return [`- ${r.stage}: ${r.note}`];
    if (r.verdict === 'pass' && r.baseline_count === 0 && r.pack_count === 0) return [`- ${r.stage}: ${NOTES.zeroInput}`];
    return [];
  });
}

// meta: { date, upstream, pack, prefilterInput }. Stage names come from the fixed stage table, never from input data.
export function formatParityReport(results, meta = {}) {
  const warnings = warningsOf(results);
  const lines = [
    '# Parity report',
    '',
    `Date: ${meta.date ?? 'unknown'}`,
    `Upstream version: ${meta.upstream ?? 'unknown'}`,
    `Pack commit: ${meta.pack ?? 'unknown'}`,
    ...(meta.prefilterInput === undefined ? [] : [`Prefilter input rows: ${meta.prefilterInput}`]),
    '',
    REPORT_HEADER,
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.stage} | ${cell(r.baseline_count)} | ${cell(r.pack_count)} | ${cell(r.added)} | ${cell(r.missing)} | ${cell(r.explained === undefined ? 0 : r.explained)} | ${r.verdict} |`),
    '',
    ...(warnings.length ? ['Warnings:', ...warnings, ''] : []),
    `Overall: ${overallVerdict(results)}`,
    '',
  ];
  return lines.join('\n');
}
