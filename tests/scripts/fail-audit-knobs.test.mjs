// Covers M-002-S1..S6: fail-audit audit knobs (exclude_reasons, require_triage, keyword_match) via the CLI,
// plus in-process judgmentPattern checks. All names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { judgmentPattern } from '../../scripts/fail-audit.mjs';

const urlFor = (i) => jobUrl(1000 + i);
const dateFor = (i) => shiftDate('2026-08-01', Math.min(i, 23));
const picked = (stdout) => {
  const v = JSON.parse(stdout);
  return (Array.isArray(v) ? v : v.rows).map((x) => x.url);
};
const skippedRow = (i, company, reason, extra = '') =>
  line(urlFor(i), company, `Role ${i}`, 'Remote', `${extra ? `${extra}; ` : ''}reason=${reason}; triaged=${dateFor(i)}; imported=${dateFor(i)}`);

function run(config, skipped) {
  const r = makeRoot({ config });
  try {
    r.write('data/pipeline.md', pipelineText({ pending: [line(jobUrl(1), 'Acme', 'Pending role')], skipped }));
    const out = runScript('fail-audit', ['pick'], r);
    assert.equal(out.code, 0, out.stderr);
    return picked(out.stdout);
  } finally {
    r.cleanup();
  }
}

// M-002-S1
test('M-002-S1 with no audit keys pick returns the earlier-wave URL list in the same order', () => {
  const config = 'judgment_keywords:\n  - grad window\n  - clearance\n  - experience\n';
  const order = Array.from({ length: 25 }, (_, k) => (k * 7) % 25);
  const skipped = [
    ...order.map((i) => skippedRow(i, 'Acme', 'grad window mismatch', 'triage=1.0')),
    line(jobUrl(2001), 'Acme', 'Sales Role', 'Remote', 'triage=1.0; reason=sales role; triaged=2026-10-20'),
    line(jobUrl(2002), 'Acme', 'Audited Role', 'Remote', 'triage=1.0; reason=clearance needed; triaged=2026-10-21; audited=2026-10-22'),
  ];
  const expected = [23, 24, ...Array.from({ length: 18 }, (_, k) => 22 - k)].map(urlFor);
  assert.deepEqual(run(config, skipped), expected);
});

// M-002-S1
test('M-002-S1 judgmentPattern word mode source is unchanged', () => {
  assert.equal(judgmentPattern(['grad', 'a.b']).source, '\\b(grad|a\\.b)');
});

// M-002-S2
test('M-002-S2 exclude_reasons drops a Manual Hold reason in any case and keeps another', () => {
  const config = 'judgment_keywords:\n  - experience\naudit:\n  exclude_reasons:\n    - manual hold\n';
  const skipped = [
    skippedRow(1, 'Acme', 'experience gap per Manual Hold', 'triage=1.0'),
    skippedRow(2, 'Globex', 'experience gap', 'triage=1.0'),
  ];
  assert.deepEqual(run(config, skipped), [urlFor(2)]);
});

// M-002-S3
test('M-002-S3 require_triage drops missing, non-numeric, zero and negative triage and keeps 1.0', () => {
  const config = 'judgment_keywords:\n  - experience\naudit:\n  require_triage: true\n';
  const skipped = [
    skippedRow(1, 'Acme', 'experience gap'),
    skippedRow(2, 'Globex', 'experience gap', 'triage=x'),
    skippedRow(3, 'Initech', 'experience gap', 'triage=0'),
    skippedRow(4, 'Vandelay', 'experience gap', 'triage=-1'),
    skippedRow(5, 'Acme', 'experience gap', 'triage=1.0'),
  ];
  assert.deepEqual(run(config, skipped), [urlFor(5)]);
});

// M-002-S3
test('M-002-S3 without require_triage rows lacking a triage note are still picked', () => {
  const config = 'judgment_keywords:\n  - experience\n';
  const skipped = [skippedRow(1, 'Acme', 'experience gap'), skippedRow(2, 'Globex', 'experience gap', 'triage=x')];
  assert.deepEqual(run(config, skipped).sort(), [urlFor(1), urlFor(2)].sort());
});

// M-002-S4
test('M-002-S4 substring mode picks undergrad only for keyword grad and word mode skips it', () => {
  const skipped = [skippedRow(1, 'Acme', 'undergrad only', 'triage=1.0')];
  const base = 'judgment_keywords:\n  - grad\naudit:\n  keyword_match: ';
  assert.deepEqual(run(`${base}substring\n`, skipped), [urlFor(1)]);
  assert.deepEqual(run(`${base}word\n`, skipped), []);
});

// M-002-S5
test('M-002-S5 a Title pre-filter reason is skipped in substring mode with every knob set', () => {
  const config = 'judgment_keywords:\n  - grad\naudit:\n  keyword_match: substring\n  exclude_reasons:\n    - zzzz\n  require_triage: true\n';
  const skipped = [
    skippedRow(1, 'Acme', 'Title pre-filter: grad role', 'triage=1.0'),
    skippedRow(2, 'Globex', 'title pre-filter: undergrad', 'triage=1.0'),
  ];
  assert.deepEqual(run(config, skipped), []);
});

// M-002-S6
test('M-002-S6 judgmentPattern substring mode has source (grad) and flag i', () => {
  const re = judgmentPattern(['grad'], 'substring');
  assert.ok(re instanceof RegExp);
  assert.equal(re.source, '(grad)');
  assert.equal(re.flags, 'i');
  assert.ok(re.test('undergrad only'));
});
