// lib/self-check.mjs check(plan) and checkAndReview(plan, opts). Plan shape (ruling): { company, role, fields:
// [{ label, value, required }], cover: <letter file path> }. The review step is a fake recorder; no agent runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-self-check-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function planWith(dir, letterCompany, name = 'letter.txt') {
  const cover = join(dir, name);
  writeFileSync(cover, `Dear hiring team,\n\nI am applying for the Software Engineering Intern role at ${letterCompany}. I built a Python scheduling tool during my internship.\n\nJordan Testwell\n`);
  return {
    company: 'Example Robotics',
    role: 'Software Engineering Intern',
    fields: [
      { label: 'Email', value: 'jordan.testwell@example.com', required: true },
      { label: 'First Name', value: 'Jordan', required: true },
    ],
    cover,
  };
}

// M-002-S24-osdr
test('M-002-S24-osdr the self-check flags a letter naming another company and keeps the item out of the batch', () =>
  withDir(async (dir) => {
    const { check } = await import('../../lib/self-check.mjs');
    const bad = check(planWith(dir, 'Contoso Analytics', 'bad.txt'), { floor: 0 });
    assert.equal(bad.ok, false);
    assert.ok((bad.flags ?? []).some((f) => /Contoso Analytics|company/i.test(String(f?.message ?? f))), JSON.stringify(bad));
    const good = check(planWith(dir, 'Example Robotics', 'good.txt'), { floor: 0 });
    assert.equal(good.ok, true, JSON.stringify(good));
  }));

// M-002-S36-osdr
test('M-002-S36-osdr with T8 off and reviewer on every batch item reaches the review step including items that pass the deterministic checks', () =>
  withDir(async (dir) => {
    const { checkAndReview } = await import('../../lib/self-check.mjs');
    const reviewed = [];
    const review = async (plan) => {
      reviewed.push(plan.cover);
      return { ok: true };
    };
    const passing = planWith(dir, 'Example Robotics', 'pass.txt');
    const flagged = planWith(dir, 'Contoso Analytics', 'flag.txt');
    await checkAndReview(passing, { reviewerOn: true, t8On: false, review });
    await checkAndReview(flagged, { reviewerOn: true, t8On: false, review });
    assert.deepEqual(reviewed, [passing.cover, flagged.cover]);

    const gated = [];
    await checkAndReview(planWith(dir, 'Contoso Analytics', 'gated.txt'), { reviewerOn: true, t8On: true, review: async (p) => (gated.push(p), { ok: true }) });
    assert.equal(gated.length, 0, 'with T8 on an item failing the deterministic checks skips the review');
  }));
