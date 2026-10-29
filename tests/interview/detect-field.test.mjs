// detect-field.mjs CLI: `node interview/detect-field.mjs <cv file>` prints the top two presets as id, score and matched resume lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const EXPECTED = {
  cs: 'software-cs',
  finance: 'finance-economics',
  mechanical: 'engineering-mech-elec',
  mis: 'mis-business-analytics',
  nursing: 'byo-employer-list',
};
const PRESET_IDS = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4));

function detect(k) {
  const file = join(PACK_ROOT, 'tests', 'fixtures', 'resumes', `${k}.md`);
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'detect-field.mjs'), file], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 30000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '', resume: readFileSync(file, 'utf8') };
}

// M-001-S12 normal
for (const [k, id] of Object.entries(EXPECTED)) {
  test(`M-001-S12 detect-field ranks ${id} first for the ${k} resume with a score`, () => {
    const res = detect(k);
    assert.equal(res.code, 0, res.stderr);
    const outLines = res.stdout.split('\n');
    const firstIdLine = outLines.find((l) => PRESET_IDS.some((p) => new RegExp(`(?<![\\w-])${p}(?![\\w-])`).test(l)));
    assert.ok(firstIdLine, `a preset id line in: ${res.stdout}`);
    assert.match(firstIdLine, new RegExp(`(?<![\\w-])${id}(?![\\w-])`), `first preset printed is ${id}`);
    assert.match(firstIdLine, /\d/, 'score printed on the id line');
  });
}

for (const k of ['cs', 'finance', 'mechanical', 'mis']) {
  test(`M-001-S12 detect-field prints matched resume lines (at most 3 per preset) for the ${k} resume`, () => {
    const res = detect(k);
    const resumeLines = res.resume.split('\n').map((l) => l.trim().replace(/^- /, '')).filter((l) => l.length >= 15 && !l.startsWith('<!--'));
    const shown = resumeLines.filter((l) => res.stdout.includes(l));
    assert.ok(shown.length >= 1, `at least one matched resume line printed in: ${res.stdout}`);
    assert.ok(shown.length <= 6, `at most 3 lines for each of the top two presets, saw ${shown.length}`);
  });
}
