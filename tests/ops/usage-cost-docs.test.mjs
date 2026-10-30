// Docs contract for the usage-cost page and the student-owned triage budget text. Reads files only, except that
// M-004-S3 runs the repo's own lint script. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PLAN_IDS, PLANS, PRICES, MEASURED } from '../../lib/usage-cost.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { readDoc, scanCommands } from '../helpers/doc-contract.mjs';

const EDITED = ['README.md', 'docs/usage.md', 'docs/codex.md', 'docs/architecture.md', 'CHANGELOG.md', 'docs/usage-cost.md'];
const SUBCOMMANDS = ['status', 'cost', 'set', 'log', 'calibrate'];

function leaves(value, pick, out = []) {
  if (pick(value)) out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) leaves(v, pick, out);
  return out;
}
const sourceUrls = () => [...new Set(leaves([PLANS, PRICES], (v) => typeof v === 'string' && /^https?:\/\//.test(v)))];
const measuredNumbers = () => [...new Set(leaves(MEASURED, (v) => typeof v === 'number' && Number.isFinite(v)))];

function missingFromDoc(text, { ids, urls }) {
  return { ids: ids.filter((id) => !text.includes(id)), urls: urls.filter((u) => !text.includes(u)) };
}

const triageBudgetCommands = (doc) =>
  readDoc(doc).split('\n').map((line, i) => ({ line, at: `${doc}:${i + 1}` }))
    .filter(({ line }) => /node student\/scripts\/triage-budget\.mjs/.test(line));
const commandOf = (line) => /node student\/scripts\/triage-budget\.mjs([^`\n]*)/.exec(line)[1].trim().replace(/\s+/g, ' ');

// M-004-S1 normal
test('M-004-S1 docs/usage-cost.md lists every plan id, every source url and the access date', () => {
  assert.ok(existsSync(join(PACK_ROOT, 'docs/usage-cost.md')), 'docs/usage-cost.md exists');
  const doc = readDoc('docs/usage-cost.md');
  const urls = sourceUrls();
  assert.ok(urls.length > 0, 'lib/usage-cost.mjs carries source urls');
  assert.deepEqual(missingFromDoc(doc, { ids: [...PLAN_IDS], urls }), { ids: [], urls: [] });
  assert.ok(PLAN_IDS.includes('claude-pro') && PLAN_IDS.includes('chatgpt-plus'));
  assert.match(doc, /not published/);
  assert.match(doc, /accessed 2026-10-30/);
});

// M-004-S1 normal
test('M-004-S1 docs/usage-cost.md states the measured constants, the method, the word estimate, /usage and /status', () => {
  const doc = readDoc('docs/usage-cost.md');
  const nums = measuredNumbers();
  assert.ok(nums.length > 0, 'MEASURED carries numeric constants');
  for (const n of nums) {
    const shown = [String(n), n.toLocaleString('en-US')];
    assert.ok(shown.some((s) => doc.includes(s)), `measured constant ${n} shown`);
  }
  assert.ok(doc.includes('scripts/ci/usage-fixture.mjs'));
  assert.match(doc, /synthetic/i);
  assert.match(doc, /upper bound/i);
  assert.match(doc, /estimate/i);
  assert.ok(doc.includes('/usage'));
  assert.ok(doc.includes('/status'));
  assert.ok(doc.includes('triage-budget.mjs calibrate'));
  assert.ok(doc.includes('triage-budget.mjs set'));
  assert.match(doc, /separate from/i);
  assert.match(doc, /lower bound/i);
  assert.ok(doc.includes('--setting-sources project'));
  assert.ok(doc.includes('--strict-mcp-config'));
  assert.ok(doc.includes('run_lock_hours'));
});

// M-004-S2 normal
test('M-004-S2 the five docs name the triage budget and none calls triage_daily a ceiling of 20', () => {
  for (const f of ['README.md', 'docs/usage.md', 'docs/codex.md', 'docs/architecture.md', 'CHANGELOG.md']) {
    const text = readDoc(f);
    assert.match(text, /triage_budget|triage-budget\.mjs|triage budget/i, `${f} names the triage budget`);
    for (const para of text.split('\n')) {
      if (f !== 'CHANGELOG.md') assert.ok(!(/triage_daily/.test(para) && /ceiling/i.test(para)), `${f}: triage_daily called a ceiling`);
      assert.ok(!/ceiling 20|ceiling of 20/i.test(para), `${f}: ceiling of 20`);
    }
  }
  assert.match(readDoc('README.md'), /docs\/usage-cost\.md/);
  assert.match(readDoc('docs/usage.md'), /usage-cost\.md/);
  assert.match(readDoc('docs/codex.md'), /usage-cost\.md/);
  assert.match(readDoc('docs/architecture.md'), /lib\/triage-budget\.mjs/);
  assert.match(readDoc('docs/architecture.md'), /data\/triage-usage\.tsv/);
  const top = readDoc('CHANGELOG.md');
  assert.match(top, /W-016/);
  assert.match(top, /triage_budget/);
  assert.match(top, /usage-cost\.md/);
  assert.match(top, /normal release/i);
});

// M-004-S3 keep
test('M-004-S3 the edited docs hold no em dash and no curly quote', () => {
  for (const f of EDITED.filter((x) => existsSync(join(PACK_ROOT, x)))) {
    const text = readDoc(f);
    assert.ok(!/[—‘’“”]/.test(text), `${f} uses plain punctuation`);
  }
});

// M-004-S3 keep
test('M-004-S3 npm run lint scripts and the doc command contract report no finding', () => {
  for (const s of ['pii-lint', 'lint-imports', 'lint-files']) {
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', `${s}.mjs`)], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, `${s}: ${r.stdout}${r.stderr}`);
  }
  for (const f of EDITED.filter((x) => existsSync(join(PACK_ROOT, x)))) assert.deepEqual(scanCommands(f, readDoc(f)), []);
});

// M-004-S4 edge
test('M-004-S4 triage-budget.mjs commands in the edited docs use only the CLI subcommands', () => {
  let seen = 0;
  const used = new Set();
  for (const f of EDITED.filter((x) => existsSync(join(PACK_ROOT, x)))) {
    for (const { line, at } of triageBudgetCommands(f)) {
      seen += 1;
      const sub = commandOf(line).split(' ')[0];
      assert.ok(SUBCOMMANDS.includes(sub), `${at}: unknown subcommand "${sub}"`);
      if (f === 'docs/usage.md') used.add(sub);
    }
  }
  assert.ok(seen > 0, 'edited docs show triage-budget.mjs commands');
  for (const sub of SUBCOMMANDS) assert.ok(used.has(sub), `docs/usage.md shows ${sub}`);
});

// M-004-S4 edge
test('M-004-S4 every set example with --confirm follows the same example without it', () => {
  let confirmed = 0;
  for (const f of EDITED.filter((x) => existsSync(join(PACK_ROOT, x)))) {
    const seenPreview = new Set();
    for (const { line, at } of triageBudgetCommands(f)) {
      const cmd = commandOf(line);
      if (!/^set\b/.test(cmd)) continue;
      if (/--confirm\b/.test(cmd)) {
        confirmed += 1;
        const bare = cmd.replace(/\s*--confirm\b/, '').trim();
        assert.ok(seenPreview.has(bare), `${at}: "set ${bare}" with --confirm has no earlier example without it`);
      } else seenPreview.add(cmd);
    }
  }
  assert.ok(confirmed > 0, 'a writing set example with --confirm is shown');
});

// M-004-S5 error
test('M-004-S5 the drift check names exactly the missing plan id and source url of a synthetic page', () => {
  const ids = ['plan-a', 'plan-b', 'plan-c'];
  const urls = ['https://example.test/one', 'https://example.test/two'];
  const page = 'plan-a plan-c https://example.test/one accessed 2026-10-30';
  assert.deepEqual(missingFromDoc(page, { ids, urls }), { ids: ['plan-b'], urls: ['https://example.test/two'] });
  assert.deepEqual(missingFromDoc(`${page} plan-b https://example.test/two`, { ids, urls }), { ids: [], urls: [] });
});
