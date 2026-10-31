// W-024 A3-8: vice president, chief, professor and general counsel titles are a senior title even after "Associate".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMerged } from '../../lib/presets.mjs';
import { prefilter } from '../../scripts/prefilter.mjs';
import { line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const CYCLE = { today: '2026-10-29', phase: 'student', terms: [], newgrad_years: [2027], internship_years: [2027], experience_ceiling_years: 1 };
const CONFIG = { dealbreakers: [], tracks: [{ kind: 'newgrad', graduation: '2027-05', resume_variant: 'grad-a' }] };
const PRESET = loadMerged(['policy-government']);
const run = (title) => prefilter({ pipelineText: pipelineText({ pending: [line(jobUrl(1), 'Example Org', title)] }), applicationsText: '', config: CONFIG, preset: PRESET, cycle: CYCLE });

test('W-024-A38 associate vice president, professor, chief and general counsel fail as a senior title', () => {
  for (const t of ['Associate Vice President, Public Policy', 'Associate VP, Policy', 'Associate Professor of Public Policy', 'Associate Chief Economist', 'Associate General Counsel, Government Affairs']) {
    const lines = run(t);
    assert.equal(lines.length, 1, t);
    assert.match(lines[0], /Title pre-filter: senior title /, t);
  }
});

test('W-024-A38 account executive, executive assistant and admissions counselor still pass both above-entry rules', () => {
  for (const t of ['Account Executive Intern', 'Executive Assistant Intern', 'Admissions Counselor Intern']) {
    assert.doesNotMatch(run(t).join('\n'), /above entry level|senior title/, t);
  }
});

test('W-024-A38 an internship in a vice president, chief or general counsel office is not a senior title', () => {
  for (const t of ['Legal Intern, Office of the General Counsel', 'Policy Intern, Office of the Chief Information Officer', 'Summer Intern - Office of the Vice President']) {
    assert.doesNotMatch(run(t).join('\n'), /senior title|above entry level/, t);
  }
});
