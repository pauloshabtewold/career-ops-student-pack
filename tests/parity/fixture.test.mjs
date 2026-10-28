import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../../lib/config.mjs';
import { loadMerged } from '../../lib/presets.mjs';
import { validateCycle } from '../../lib/cycle-file.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'parity', 'student.yml');
const DEFAULTS = join(ROOT, 'templates', 'student.defaults.yml');
const tmpDirs = [];

after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// M-003-S1
test('M-003-S1 the parity fixture parses over the defaults and every listed preset loads', () => {
  const cfg = parseConfig(readFileSync(FIXTURE, 'utf8'), readFileSync(DEFAULTS, 'utf8'));
  assert.ok(Array.isArray(cfg.presets) && cfg.presets.length > 0);
  assert.ok(Array.isArray(cfg.tracks) && cfg.tracks.length > 0);
  for (const p of cfg.presets) assert.ok(loadMerged([p]), `preset ${p} did not load`);
  assert.ok(loadMerged(cfg.presets));
});

// M-003-S2
test('M-003-S2 pack cycle.mjs prints a valid cycle with a term for a copy of the fixture', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'parity-fixture-'));
  tmpDirs.push(tmp);
  mkdirSync(join(tmp, 'config'), { recursive: true });
  cpSync(FIXTURE, join(tmp, 'config', 'student.yml'));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'cycle.mjs'), '--json', '--today', '2026-10-28', '--root', tmp], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const cycle = validateCycle(JSON.parse(r.stdout));
  assert.ok(cycle.terms.length >= 1);
});
