// Quality bars every token lever must meet before it ships. The stated bars are fixed before any measurement run;
// tools/quality-baseline.mjs freeze rewrites the AA, EFFECTIVE and FROZEN exports once with the A/A noise values and the
// effective bars, and the P0 manifest pins this file's sha256, so tools/lever-ab.mjs refuses to judge against a bar
// edited after the baseline. docs/quality-gate.md carries the same numbers in a table (tests/ops/quality-gate-docs.test.mjs
// keeps them equal).

// Number of top-ranked postings compared when measuring triage overlap.
export const TOP_N = 10;

// Stated bars, fixed before any run.
export const OVERLAP_MIN = 0.9;
export const INVENTED_FACTS_MAX = 0;
export const JUDGE_NOT_WORSE_MIN = 0.9;
// The three accuracy bars are the largest allowed drop below the recorded base accuracy: 0 means "not lower".
export const FORM_ACCURACY = 0;
export const CLASSIFY_ACCURACY = 0;
export const REPLY_SORT_ACCURACY = 0;
export const SCAM_FP_MAX = 0.02;

// Bars fixed before any lever runs, keyed by constant name; effectiveBars relaxes them against A/A noise.
export const STATED = Object.freeze({
  OVERLAP_MIN,
  INVENTED_FACTS_MAX,
  JUDGE_NOT_WORSE_MIN,
  FORM_ACCURACY,
  CLASSIFY_ACCURACY,
  REPLY_SORT_ACCURACY,
  SCAM_FP_MAX,
});

// Fixture items per measured step.
export const SAMPLE_SIZES = Object.freeze({
  postings: 60,
  cover_pairs: 12,
  outreach_pairs: 12,
  reply_pairs: 12,
  mock_forms: 6,
  risk_postings: 30,
  outcome_mails: 20,
  labeled_replies: 50,
});

// Bars that are rates of harm, not noisy agreement measures: the P0 A/A run never moves their effective value. On the
// draft steps option A (below) adds a per-step allowance equal to the same-day A/A control count (inventedAllowance);
// where no same-day A/A count exists the fixed 0 holds.
export const FIXED_BARS = Object.freeze(['INVENTED_FACTS_MAX', 'SCAM_FP_MAX']);
// Bars where a higher value is better; the A/A value lowers them. The accuracy-drop bars widen to the A/A spread instead.
const MIN_BARS = ['OVERLAP_MIN', 'JUDGE_NOT_WORSE_MIN'];

// null until freeze records the A/A repeat of the baseline capture.
export const AA = Object.freeze({
  "OVERLAP_MIN": 0.8,
  "INVENTED_FACTS_MAX": 2,
  "JUDGE_NOT_WORSE_MIN": 0.5555555555555556,
  "FORM_ACCURACY": 0,
  "CLASSIFY_ACCURACY": 0,
  "REPLY_SORT_ACCURACY": 0.020000000000000018,
  "SCAM_FP_MAX": 0
});

// Equal to STATED until freeze; after freeze, a bar moves only to the A/A value measured on the same sample.
export const EFFECTIVE = Object.freeze({
  "OVERLAP_MIN": 0.8,
  "INVENTED_FACTS_MAX": 0,
  "JUDGE_NOT_WORSE_MIN": 0.5555555555555556,
  "FORM_ACCURACY": 0,
  "CLASSIFY_ACCURACY": 0,
  "REPLY_SORT_ACCURACY": 0.020000000000000018,
  "SCAM_FP_MAX": 0.02
});

// Null until quality-baseline freeze records the freeze time.
export const FROZEN = "2026-11-21T14:32:15.502Z";

// Option A for INVENTED_FACTS_MAX on the draft steps (cover, outreach, reply): a lever's added invented items on one agent
// and draft step may be at most what a second lever-off draft adds on its own on that step, measured the same day by the
// A/B tool's A/A control arm in the same unit (judge_added plus gate_added over its control). The free P0 proxy is
// informational only, so a step with no measured entry gets 0. Every other step, and every other bar, is unchanged.
export const INVENTED_FACTS_OPTION = 'A';

// The option A allowance of one agent/step key (for example 'claude/cover') from an A/A per-step map; 0 when the map has
// no measured entry for it, or when pairs is given and the A/A entry judged a different number of pairs.
export function inventedAllowance(aaPerStep, key, pairs = null) {
  const s = aaPerStep?.[key];
  const n = (Number(s?.judge_added) || 0) + (Number(s?.gate_added) || 0);
  if (!s || !(Number(s.pairs) > 0)) return 0;
  return pairs === null || Number(s.pairs) === Number(pairs) ? n : 0;
}

// A min bar drops to its A/A value when the A/A agreement is lower (two identical runs cannot beat their own noise);
// an accuracy-drop bar widens to the A/A spread; fixed bars never move.
export function effectiveBars(stated, aa) {
  const out = { ...stated };
  if (!aa) return out;
  for (const [key, value] of Object.entries(stated)) {
    const noise = aa[key];
    if (FIXED_BARS.includes(key) || typeof noise !== 'number') continue;
    out[key] = MIN_BARS.includes(key) ? Math.min(value, noise) : Math.max(value, noise);
  }
  return out;
}
