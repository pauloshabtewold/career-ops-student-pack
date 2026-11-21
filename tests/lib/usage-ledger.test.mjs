// lib/usage-ledger.mjs rows in data/usage-ledger.tsv, written directly and through lib/headless.mjs runHeadless with a
// fake runner (no agent CLI runs). Columns: date step feature agent model rows input cache_read cache_write output source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATE = '2026-11-03';
const HEADER = 'date\tstep\tfeature\tagent\tmodel\trows\tinput\tcache_read\tcache_write\toutput\tsource';

async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-usage-ledger-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ledgerLines = (dir) => {
  const file = join(dir, 'usage-ledger.tsv');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()) : [];
};
const cells = (line) => Object.fromEntries(HEADER.split('\t').map((k, i) => [k, line.split('\t')[i]]));

// A runText-shaped runner: (cmd, args, opts) -> stdout. A codex call gets its answer file written at the -o path.
const fakeRunner = (stdout, calls = []) => (cmd, args = [], opts = {}) => {
  calls.push({ cmd, args, opts });
  const o = args.indexOf('-o');
  if (o >= 0 && args[o + 1]) writeFileSync(String(args[o + 1]).replace(/^"|"$/g, ''), 'Fake answer text.');
  return stdout;
};

// M-002-S10-osdr
test('M-002-S10-osdr a cover call returning JSON usage appends one ledger row with feature M8 and real token counts while a batch write appends a zero-token row for H3', () =>
  withDir(async (dir) => {
    const { runHeadless } = await import('../../lib/headless.mjs');
    const { append, zeroRow } = await import('../../lib/usage-ledger.mjs');
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Fake tailored paragraph.',
      usage: { input_tokens: 120, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 45 },
    });
    await runHeadless({ agent: 'claude', model: 'sonnet', prompt: 'Write one fake paragraph.', step: 'cover', feature: 'M8', dataDir: dir, date: DATE, runner: fakeRunner(stdout), agentPath: '/fake/bin/claude', platform: 'darwin' });
    await append(dir, zeroRow({ date: DATE, step: 'batch', feature: 'H3' }));

    const lines = ledgerLines(dir);
    assert.equal(lines[0], HEADER);
    assert.equal(lines.length, 3, lines.join('\n'));
    const cover = cells(lines[1]);
    assert.deepEqual(
      { feature: cover.feature, agent: cover.agent, model: cover.model, input: cover.input, cache_read: cover.cache_read, cache_write: cover.cache_write, output: cover.output },
      { feature: 'M8', agent: 'claude', model: 'sonnet', input: '120', cache_read: '30', cache_write: '10', output: '45' },
    );
    assert.equal(lines[2], `${DATE}\tbatch\tH3\tnone\tnone\t0\t0\t0\t0\t0\tscheduled`);
  }));

// M-002-S11-osdr
test('M-002-S11-osdr codex usage events of one call sum into one ledger row', () =>
  withDir(async (dir) => {
    const { runHeadless } = await import('../../lib/headless.mjs');
    const stdout = [
      { type: 'thread.started', thread_id: 'th-fake' },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } },
      { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'Fake answer text.' } },
      { type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n');
    await runHeadless({ agent: 'codex', effort: 'medium', prompt: 'Fake prompt.', step: 'cover', feature: 'M8', dataDir: dir, date: DATE, runner: fakeRunner(stdout), agentPath: '/fake/bin/codex', platform: 'darwin' });
    const lines = ledgerLines(dir);
    assert.equal(lines.length, 2, `header plus one row:\n${lines.join('\n')}`);
    const row = cells(lines[1]);
    assert.equal(row.agent, 'codex');
    assert.equal(row.input, '150');
    assert.equal(row.output, '25');
  }));

// M-002-S17-osdr
test('M-002-S17-osdr an agent answer without usage writes unmeasured in every token column', () =>
  withDir(async (dir) => {
    const { append, ledgerRow } = await import('../../lib/usage-ledger.mjs');
    await append(dir, ledgerRow({ date: DATE, step: 'review', feature: 'H4', agent: 'claude', model: 'sonnet', rows: 1, usage: null }));
    const lines = ledgerLines(dir);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.equal(lines[1], `${DATE}\treview\tH4\tclaude\tsonnet\t1\tunmeasured\tunmeasured\tunmeasured\tunmeasured\tscheduled`);
  }));
