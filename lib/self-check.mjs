// Pre-submit self-check for each fill plan, run before the item may enter a batch. Plain code: required fields filled,
// the letter names this plan's company and role, repeated words, double spaces, unmatched brackets, sentence-start case,
// and the keyword overlap between the resume and the job text, which is only reported (notes). Mechanical faults are
// fixed once; anything else flags the item and keeps it out of the batch on both review orders.
import { existsSync, readFileSync } from 'node:fs';

export const KEYWORD_FLOOR = 0.15;
const STOP = new Set('a an and are as at be by for from has have in is it of on or our that the their this to we will with you your'.split(' '));

const words = (text) => String(text ?? '').toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];

// Share of job keywords (stop words ignored) present in the resume; 1 when the job text has none.
export function keywordOverlap(resumeText, jobText) {
  const job = new Set(words(jobText).filter((w) => !STOP.has(w)));
  if (!job.size) return 1;
  const resume = new Set(words(resumeText));
  return [...job].filter((w) => resume.has(w)).length / job.size;
}

function fixText(text) {
  return String(text ?? '')
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function bracketsBalanced(text) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const c of String(text ?? '')) {
    if ('([{'.includes(c)) stack.push(c);
    else if (pairs[c] && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

// The letter text: plan.letter, else the file at plan.cover.
const letterOf = (plan) => plan.letter ?? (plan.cover && existsSync(plan.cover) ? readFileSync(plan.cover, 'utf8') : null);

// plan = { company, role, fields: [{ label, required, value }], letter | cover (letter file path), resumeText, jobText }
// Returns { ok, fixed, flags, plan } where plan carries the fixed letter and field values.
export function check(plan, { floor = KEYWORD_FLOOR } = {}) {
  const flags = [];
  const fixed = [];
  const out = { ...plan, letter: letterOf(plan), fields: (plan.fields ?? []).map((f) => ({ ...f })) };
  if (out.letter) {
    const next = fixText(out.letter);
    if (next !== out.letter) fixed.push('letter spacing, repeated words or sentence case');
    out.letter = next;
    const lower = next.toLowerCase();
    if (plan.company && !lower.includes(String(plan.company).toLowerCase())) flags.push(`letter does not name the company ${plan.company}`);
    if (plan.role && !lower.includes(String(plan.role).toLowerCase())) flags.push(`letter does not name the role ${plan.role}`);
    if (!bracketsBalanced(next)) flags.push('letter has unmatched brackets');
  }
  for (const f of out.fields) {
    if (typeof f.value === 'string') {
      const next = f.value.replace(/ {2,}/g, ' ').trim();
      if (next !== f.value) fixed.push(`spacing in ${f.label}`);
      f.value = next;
    }
    if (f.required && (f.value === undefined || f.value === null || f.value === '')) flags.push(`required field empty: ${f.label}`);
  }
  // The overlap is reported, never a flag: measured over every unique word of a whole posting, real postings sit near
  // 10% against a real resume, so a floor at that scale kept every posting with readable text out of every batch.
  const notes = [];
  if (plan.resumeText && plan.jobText) {
    const overlap = keywordOverlap(plan.resumeText, plan.jobText);
    if (overlap < floor) notes.push(`resume shares ${Math.round(overlap * 100)}% of the job's keywords (below ${Math.round(floor * 100)}%; reported only)`);
  }
  return { ok: flags.length === 0, fixed, flags, notes, plan: out };
}

// Review order. T8 off (default): with the reviewer on, the modes/review.md review runs on every item first, as in v0.4,
// then the checks. T8 on: the checks run first and only items they pass go to the review. A flagged item stays out of
// the batch either way. review(plan) is async and returns { ok, notes }.
export async function checkAndReview(plan, { reviewerOn = false, t8On = false, review = null } = {}) {
  const runReview = reviewerOn && review;
  if (t8On) {
    const res = check(plan);
    if (!res.ok || !runReview) return { ...res, reviewed: false };
    const rv = await review(res.plan);
    return { ...res, ok: rv.ok, flags: rv.ok ? res.flags : [...res.flags, ...(rv.notes ?? [])], reviewed: true };
  }
  const rv = runReview ? await review(plan) : { ok: true, notes: [] };
  const res = check(plan);
  return { ...res, ok: res.ok && rv.ok, flags: rv.ok ? res.flags : [...res.flags, ...(rv.notes ?? [])], reviewed: Boolean(runReview) };
}
