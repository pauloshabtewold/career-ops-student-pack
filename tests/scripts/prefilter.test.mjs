// Assumed: scripts/prefilter.mjs exports prefilter({ pipelineText, applicationsText, config, preset }) -> string[]
// (one TRIAGE FAIL line per failing Pending row). config carries dealbreakers; preset carries early_career and
// title_rules.exclude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefilter } from '../../scripts/prefilter.mjs';
import { line, pipelineText, jobUrl, PRESET } from '../helpers/script-harness.mjs';

const CONFIG = { dealbreakers: ['clearance'] };
const FAIL_RE = /^TRIAGE: FAIL \| (\S+) \| 0\.0\/5 \| Title pre-filter: .+ \((.+)\)$/;

const pending = [
  line(jobUrl(1), 'Example Robotics', 'Sales Development Intern'),
  line(jobUrl(2), 'Example Robotics', 'Software Intern (Security Clearance Required)'),
  line(jobUrl(3), 'Example Robotics', 'Senior Software Engineer'),
  line(jobUrl(4), 'Example Robotics', 'Software Engineer Intern'),
  line(jobUrl(5), 'Example Robotics', 'Staff Data Engineer', 'Remote', 'triage=1.0; reason=already judged'),
  line(jobUrl(6), 'Example Robotics', 'PhD Research Scientist Intern'),
  line(jobUrl(7), 'Example Robotics', 'Software Engineer'),
];
const skipped = [line(jobUrl(8), 'Example Robotics', 'Director of Engineering')];

// M-004-S4
test('M-004-S4 emits one TRIAGE FAIL line per exclude, dealbreaker, above-entry, PhD and non-early-career title', () => {
  const lines = prefilter({ pipelineText: pipelineText({ pending, skipped }), applicationsText: '', config: CONFIG, preset: PRESET });
  const failed = new Map(lines.map((l) => {
    const m = FAIL_RE.exec(l);
    assert.ok(m, `bad line shape: ${l}`);
    return [m[1], m[2]];
  }));
  assert.equal(lines.length, 5);
  assert.deepEqual([...failed.keys()].sort(), [jobUrl(1), jobUrl(2), jobUrl(3), jobUrl(6), jobUrl(7)].sort());
  assert.equal(failed.get(jobUrl(1)), 'Sales Development Intern');
  assert.equal(failed.get(jobUrl(3)), 'Senior Software Engineer');
});

// M-004-S4
test('M-004-S4 prints nothing for a passing title, a row with a triage token or a row outside Pending', () => {
  const lines = prefilter({ pipelineText: pipelineText({ pending, skipped }), applicationsText: '', config: CONFIG, preset: PRESET });
  const joined = lines.join('\n');
  assert.ok(!joined.includes(jobUrl(4)));
  assert.ok(!joined.includes(jobUrl(5)));
  assert.ok(!joined.includes(jobUrl(8)));
});

// M-004-S4
test('M-004-S4 an all-clean Pending section yields no lines', () => {
  const lines = prefilter({ pipelineText: pipelineText({ pending: [pending[3]] }), applicationsText: '', config: CONFIG, preset: PRESET });
  assert.deepEqual(lines, []);
});
