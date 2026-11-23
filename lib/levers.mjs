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
import { existsSync, readFileSync } from 'node:fs';
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

// Lever verdict file from the pack root, or null when absent.
export function readVerdicts(packRoot = PACK_ROOT) {
  const file = join(packRoot, VERDICTS_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
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
// solo-passing lever off, and so does a verdict with no bars_sha256 or sample_hash (not written by a solo run, so stale).
// A verdict file with no stacked record at all falls back to the verdict word.
const stackedAllows = (verdicts, id) => {
  const st = verdicts?.stacked;
  if (!st || typeof st !== 'object') return true;
  const entry = verdicts.levers?.[id];
  if (!entry?.bars_sha256 || !entry?.sample_hash) return false;
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
