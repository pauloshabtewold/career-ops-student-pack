// Registry of every token lever. Three kinds, because they carry different risk:
// - plumbing levers change no judged output and ship on (T1, T13, T15);
// - gated levers change a judged output, are built into the feature with an off path that keeps the v0.4 agent work,
//   and ship off until a P5 pass verdict (T3, T6, T7, T8, T14, T16);
// - tuning levers are added in P5 and stay off until a pass verdict (T2, T4, T5, T9-T12, T17, economy_tier, jd_trim,
//   batch_size).
// docs/lever-verdicts.json is the only thing that turns a lever on. A student may turn any lever off, never force one on.
// Verdicts: pass = on, milder = on at the milder setting the A/B accepted, fail = the off path; pending is no verdict yet
// (plumbing levers stay on, gated and tuning levers off). A stacked run whose status says blocked-on-user (a stopped run or 3 stacked rounds that all
// missed a bar) turns every gated and tuning lever off; plumbing levers keep their solo verdicts. A gated or tuning lever
// turns on only after a completed stacked run includes it (stackedAllows).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERDICTS_FILE = join('docs', 'lever-verdicts.json');
export const OVERRIDES_FILE = join('config', 'levers.yml');

const lever = (kind, on, off) => Object.freeze({ kind, on, off });

export const LEVERS = Object.freeze({
  T1: lever('plumbing', 'triage only new or changed postings (job-text hash)', 'triage every untriaged row'),
  T2: lever('tuning', 'a cheaper model pre-screens all, the standard tier makes every final score for top and borderline rows', 'one tier scores all'),
  T3: lever('gated', 'learned per-ATS field maps in data/ats-maps.json', 'static ATS maps and answer bank only'),
  T4: lever('tuning', 'reuse a tailored resume past the similarity threshold', 'tailor every resume'),
  T5: lever('tuning', 'outreach base per contact type plus one AI line', 'AI writes the whole message'),
  T6: lever('gated', 'code sorts replies first; AI only for needs-answer', 'AI suggestion for every reply'),
  T7: lever('gated', 'outcome rules first; AI only for unmatched mail', 'AI classifies every outcome-candidate mail'),
  T8: lever('gated', 'deterministic checks first; review only items they pass', 'review every item, then the checks'),
  T9: lever('tuning', 'one short AI summary line on the digest', 'code-built digest only'),
  T10: lever('tuning', 'lean instruction file for headless runs', 'shipped instructions'),
  T11: lever('tuning', 'short structured outputs with word limits', 'free-form outputs'),
  T12: lever('tuning', 'Codex low effort, web search off, trimmed AGENTS', 'Codex medium effort'),
  T13: lever('plumbing', 'dedupe by url key and company plus title before fetch', 'fetch every row'),
  T14: lever('gated', 'session-start prints the code-built Next/Type/Why block', 'session-start prints the pattern rule'),
  T15: lever('plumbing', 'setup in plain scripts; resume and profile read once and cached', 'read on every step'),
  T16: lever('gated', 'scam and ghost rules before the model', 'rules turn the model verdict into FAIL after the call'),
  T17: lever('tuning', 'browser reads capped to text at the tested limit, then the link refs', 'full page reads'),
  // Field mapping only: triage final scores never drop below triage_tier_min (standard) in budget.mjs; the cheaper triage
  // pre-screen is T2.
  economy_tier: lever('tuning', 'haiku or codex low effort for field mapping', 'sonnet or codex medium'),
  jd_trim: lever('tuning', 'job text trimmed to requirement sections', 'job text cut at 6000 characters'),
  batch_size: lever('tuning', 'tested rows per triage call', '20 rows per triage call'),
});

export const LEVER_IDS = Object.freeze(Object.keys(LEVERS));

const sha = (data) => createHash('sha256').update(data).digest('hex');
const FIXTURES = join('tests', 'fixtures', 'quality');
const BAR_FILES = [join('lib', 'quality-bars.mjs'), join('docs', 'quality-gate.md')];

// The fixed A/B sample, relative to tests/fixtures/quality: exactly the files tools/lever-ab.mjs reads (the triage
// postings, the rule and form fixtures, the lever fixtures, each profile's brief, resume, profile and draft inputs, and
// the P0 baseline's manifest, which pins every baseline output, plus its noise record). Any other fixture can change
// without touching a verdict. PIN_PROFILES equals tools/quality-baseline.mjs PROFILES (a test checks it).
export const PIN_PROFILES = Object.freeze(['software-cs', 'finance-economics', 'nursing', 'policy-government', 'mis-business-analytics']);
export const SAMPLE_FILES = Object.freeze([
  'postings.json',
  'forms.json',
  'outcome-mails.json',
  'replies-labeled.json',
  'postings-risk/legit-contacts.json',
  ...['ats-maps.json', 'form-keys.json', 'resume-pairs.json', 'self-check-items.json', 'digests.json', 'guided-states.json', 'pages.json'].map((f) => `levers/${f}`),
  ...PIN_PROFILES.flatMap((p) => ['brief.md', 'resume.md', 'profile.yml', 'cover.json', 'outreach.json', 'replies.json'].map((f) => `profiles/${p}/${f}`)),
  'baseline/manifest.json',
  'baseline/noise.json',
]);
const sampleFile = (packRoot, f) => join(packRoot, FIXTURES, ...f.split('/'));

// The pins a verdict was measured under, computed from the pack as it is now: barsSha over the two bar files (the value
// tools/lever-ab.mjs checkPins records while they match the P0 manifest) and sample over SAMPLE_FILES (a missing file
// counts as missing). barsSha is null when a bar file is absent.
export function leverPins(packRoot = PACK_ROOT) {
  const sample = sha([...SAMPLE_FILES].sort().map((f) => `${f}:${existsSync(sampleFile(packRoot, f)) ? sha(readFileSync(sampleFile(packRoot, f))) : 'missing'}`).join('\n'));
  const bars = BAR_FILES.map((f) => join(packRoot, f));
  return { barsSha: bars.every((f) => existsSync(f)) ? sha(bars.map((f) => sha(readFileSync(f))).join('')) : null, sample };
}

// Cached per pack root while no pinned file changed size or mtime, so a long process still sees an edit.
const pinCache = new Map();
const stamp = (packRoot) => [...SAMPLE_FILES.map((f) => sampleFile(packRoot, f)), ...BAR_FILES.map((f) => join(packRoot, f))].map((f) => {
  try {
    const st = statSync(f);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return '-';
  }
}).join(',');
const currentPins = (packRoot) => {
  const key = stamp(packRoot);
  const hit = pinCache.get(packRoot);
  if (hit?.key === key) return hit.pins;
  const pins = leverPins(packRoot);
  pinCache.set(packRoot, { key, pins });
  return pins;
};
const realOf = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// Lever verdict file from the pack root, or null when absent. The pack root rides along (not enumerable), so resolve can
// compare each verdict's pins with the pack's current ones. The shipped file (this pack's own docs/lever-verdicts.json)
// with no stacked record reads as a stacked run that never passed, so it can turn no gated or tuning lever on; a verdict
// file in another pack root (a test copy) keeps the fallback to the verdict word.
export function readVerdicts(packRoot = PACK_ROOT) {
  const file = join(packRoot, VERDICTS_FILE);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object') return data;
  if (realOf(packRoot) === realOf(PACK_ROOT) && (!data.stacked || typeof data.stacked !== 'object')) data.stacked = { status: 'no stacked record in the shipped verdict file', final: [] };
  Object.defineProperty(data, 'packRoot', { value: packRoot, enumerable: false });
  return data;
}

// config/levers.yml maps a lever id to off; any other value is ignored because config may never force a lever on.
export function readOverrides(root) {
  const file = root ? join(root, OVERRIDES_FILE) : null;
  if (!file || !existsSync(file)) return {};
  const doc = yaml.load(readFileSync(file, 'utf8')) ?? {};
  return typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
}

const defaultOn = (kind) => kind === 'plumbing';

const blocked = (verdicts) => /^blocked-on-user/.test(String(verdicts?.stacked?.status ?? ''));
// A file tools/lever-ab.mjs wrote always carries a stacked record. Then a gated or tuning lever is on only when a
// completed stacked run passed with it in its final set; a pending, running, stopped or missed stacked run keeps every
// solo-passing lever off, and so does a verdict with no bars_sha256 or sample_hash (not written by a solo run) or, when
// the file was read from a pack root, pins that differ from the pack's current bars and fixtures (stale). A verdict file
// with no stacked record at all falls back to the verdict word (readVerdicts gives the shipped file one).
const stackedAllows = (verdicts, id) => {
  const st = verdicts?.stacked;
  if (!st || typeof st !== 'object') return true;
  const entry = verdicts.levers?.[id];
  if (!entry?.bars_sha256 || !entry?.sample_hash) return false;
  if (verdicts.packRoot) {
    const now = currentPins(verdicts.packRoot);
    if (entry.bars_sha256 !== now.barsSha || entry.sample_hash !== now.sample) return false;
  }
  return /^stacked pass/.test(String(st.status ?? '')) && Array.isArray(st.final) && st.final.includes(id);
};

// Returns { id, kind, on, setting, value } where setting is on, off or milder and value is the tested setting (a word
// limit, a row count, a threshold) when the verdict recorded one.
export function resolve(id, { verdicts = readVerdicts(), overrides = {} } = {}) {
  const def = LEVERS[id];
  if (!def) throw new Error(`unknown lever ${id}`);
  const entry = verdicts?.levers?.[id];
  const word = String(entry?.verdict ?? '').toLowerCase();
  let setting = defaultOn(def.kind) ? 'on' : 'off';
  if (word === 'pass') setting = 'on';
  else if (word === 'milder') setting = 'milder';
  else if (word === 'fail') setting = 'off';
  if (def.kind !== 'plumbing' && (blocked(verdicts) || (setting !== 'off' && !stackedAllows(verdicts, id)))) setting = 'off';
  if (String(overrides[id] ?? '').toLowerCase() === 'off' || overrides[id] === false) setting = 'off';
  const value = setting === 'off' ? null : (entry?.setting ?? null);
  return { id, kind: def.kind, on: setting !== 'off', setting, value: value === 'on' ? null : value };
}

export const isOn = (id, opts) => resolve(id, opts).on;

// The value a caller uses for a lever: fallback (the off path's value) while the lever resolves off, else the tested
// setting the verdict recorded, or fallback when it recorded none.
export function valueOf(id, fallback, opts) {
  const r = resolve(id, opts);
  return r.on ? (r.value ?? fallback) : fallback;
}

// Lever options for a pack root and a student root: the pack's verdict file and the student's config/levers.yml.
export const leverOpts = (packRoot = PACK_ROOT, root = null) => ({ verdicts: readVerdicts(packRoot), overrides: readOverrides(root) });
