// The shipped docs/lever-verdicts.json and docs/token-report.md, and the triage tier under an economy_tier pass. The tier
// check runs dailyTriage with packRoot set to a linked copy of the pack whose verdict file holds the pass and an injected
// runner; no agent process starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CEILINGS } from '../../scripts/budget.mjs';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { ALL_LEVERS, PACK_ROOT, beforeAfter, packFarm, soloVerdict, verdictOf, wordOf } from '../helpers/lever-harness.mjs';
import { PLUS, args, makeRunner, makeTriageRoot, untriaged } from '../helpers/triage-harness.mjs';

const FEATURES = ['setup', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'U1', 'U2', 'U3', 'U4', 'U5', 'U8', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9', 'H2', 'H3', 'H4', 'H5'];
const present = (x) => x !== undefined && x !== null && x !== '' && !(typeof x === 'object' && Object.keys(x).length === 0);
const cellsOf = (row) => row.split('|').slice(1, -1).map((c) => c.trim().replace(/[`*]/g, ''));
const NUMBER = /^~?\d[\d,]*(\.\d+)?$/;

// M-006-S2-osdr
test('M-006-S2-osdr normal: every registered lever has a verdict with tokens and quality before and after', () => {
  const file = join(PACK_ROOT, 'docs', 'lever-verdicts.json');
  assert.ok(existsSync(file), 'docs/lever-verdicts.json exists');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const id of ALL_LEVERS) {
    const v = verdictOf(data, id);
    assert.ok(v, `${id} has a verdict`);
    assert.match(wordOf(v), /^(pass|fail|milder)$/, `${id} verdict word`);
    for (const t of beforeAfter(v, 'tokens')) assert.ok(Number.isFinite(t), `${id} tokens before and after: ${JSON.stringify(v)}`);
    for (const q of beforeAfter(v, 'quality')) assert.ok(present(q), `${id} quality before and after: ${JSON.stringify(v)}`);
  }
});

// M-006-S3-osdr
test('M-006-S3-osdr normal: token-report.md has a row for every P1-P4 feature id with tokens before and after and a verdict or no AI cost reason', () => {
  const file = join(PACK_ROOT, 'docs', 'token-report.md');
  assert.ok(existsSync(file), 'docs/token-report.md exists');
  const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().startsWith('|')).map((l) => cellsOf(l.trim()));
  for (const id of FEATURES) {
    const mine = rows.filter((c) => c[0] === id || c[0].startsWith(`${id} `));
    assert.ok(mine.length > 0, `token-report.md has a row for ${id}`);
    const ok = mine.some((c) => {
      const text = c.join(' | ');
      if (/no AI cost\W+\w+/i.test(text)) return true;
      return c.filter((x) => NUMBER.test(x)).length >= 2 && /\b(pass|fail|milder)\b/i.test(text);
    });
    assert.ok(ok, `${id}: tokens before and after with a verdict, or no AI cost with why:\n${mine.map((c) => c.join(' | ')).join('\n')}`);
  }
});

// M-006-S6-osdr
test('M-006-S6-osdr edge: triage_tier_min stays standard even with an economy_tier pass in the verdict file', async () => {
  assert.equal(CEILINGS.triage_tier_min.value, 'standard');
  const r = makeTriageRoot({ config: PLUS, pending: untriaged(5) });
  const farm = packFarm({ economy_tier: soloVerdict('pass', 0) });
  try {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), packRoot: farm.dir, runner });
    assert.ok(calls.claude.length > 0, 'the triage made a call');
    for (const c of calls.claude) assert.equal(c.args[c.args.indexOf('--model') + 1], 'sonnet', 'every triage score comes from the standard tier');
  } finally {
    r.cleanup();
    farm.cleanup();
  }
});
