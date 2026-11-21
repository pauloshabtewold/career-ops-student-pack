// tools/quality-baseline.mjs call timeout and retry, capture --resume, the Codex model id and the parked Codex arm. Each
// capture runs with root set to a scratch copy of the pack in its own git repo with a release tag, like
// tests/ops/quality-baseline.test.mjs; the runner is a fake, and the process-level cases start a fake codex script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import * as tool from '../../tools/quality-baseline.mjs';
import { AGENT_TIMEOUT_MS } from '../../lib/agent.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TAG = 'v9.9.9-qbresume';
const USAGE = { input_tokens: 1000, output_tokens: 100 };
const MODEL = { claude: 'claude-fake-model-1', codex: 'codex-fake-model-1' };
const resolve = (agent) => `/fake/bin/${agent}`;
const quiet = () => {};
const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function packRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'qb-resume-'));
  const skip = new Set(['.git', 'node_modules']);
  const baseline = join(PACK_ROOT, 'tests', 'fixtures', 'quality', 'baseline');
  cpSync(PACK_ROOT, dir, { recursive: true, filter: (src) => !skip.has(basename(src)) && src !== baseline && !src.startsWith(baseline + sep) });
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture'], ['tag', TAG]]) {
    const r = git(dir, args);
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  }
  return { dir, baseline: join(dir, 'tests', 'fixtures', 'quality', 'baseline'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out.sort();
}
const snapshot = (dir) => Object.fromEntries(filesUnder(dir).map((f) => [relative(dir, f), readFileSync(f, 'utf8')]));
const callRows = (baseline) => filesUnder(baseline).filter((f) => basename(f) === 'calls.tsv').flatMap((f) => readFileSync(f, 'utf8').split('\n').slice(1).filter(Boolean));
const runJson = (baseline) => JSON.parse(readFileSync(join(baseline, 'run.json'), 'utf8'));

// Answers with one triage line per posting URL and a judge verdict; fail(call, attempt) may return a failed reply instead.
function fakeRunner({ fail = null } = {}) {
  const calls = [];
  const attempts = new Map();
  const runner = (call) => {
    calls.push(call);
    const key = `${call.agent}\n${call.prompt}`;
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    const failed = fail?.(call, n);
    if (failed) return failed;
    const urls = [...new Set(String(call.prompt).match(/https?:\/\/[^\s|<>"')]+/g) ?? [])];
    const text = [...urls.map((u, i) => `TRIAGE: PASS | ${u} | ${(5 - i * 0.01).toFixed(2)} | fits the rules`), '{"verdict":"tie","invented_facts":0}'].join('\n');
    return { status: 0, text, usage: USAGE, model: MODEL[call.agent] };
  };
  return { runner, calls, attempts };
}
const timedOut = () => ({ status: 1, text: '', usage: null, model: null, error: 'timed out after 360000 ms', timedOut: true });

test('M-001-S19-osdr timeout every call carries a timeout and a timed-out call is retried once', async () => {
  const p = packRepo();
  try {
    const fake = fakeRunner({ fail: (call, n) => (n === 1 && call.agent === 'codex' && /TRIAGE/.test(call.prompt) ? timedOut() : null) });
    const code = await tool.capture({ root: p.dir, runner: fake.runner, resolve, say: quiet });
    assert.equal(code, 0);
    for (const c of fake.calls) assert.ok(c.timeoutMs > 0 && c.timeoutMs <= AGENT_TIMEOUT_MS, `timeout ${c.timeoutMs}`);
    assert.ok([...fake.attempts.values()].some((n) => n > 2), 'a timed-out call ran again');
    assert.equal(runJson(p.baseline).status, 'complete');
  } finally {
    p.cleanup();
  }
});

test('M-001-S19-osdr timeout a real process past its timeout is killed and reported as timed out', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-hang-'));
  try {
    const bin = join(dir, 'codex');
    writeFileSync(bin, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`);
    chmodSync(bin, 0o755);
    const started = Date.now();
    const res = tool.defaultRunner({ agent: 'codex', agentPath: bin, prompt: 'hello', timeoutMs: 500 });
    assert.ok(Date.now() - started < 20000, 'the hung call returned within seconds');
    assert.equal(res.timedOut, true);
    assert.match(res.error, /timed out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-001-S19-osdr resume skips recorded calls and keeps the run base and commit', async () => {
  const p = packRepo();
  try {
    // First run: a quota stop on the 10th Codex call leaves a partial capture.
    let codexCalls = 0;
    const first = fakeRunner({ fail: (call) => (call.agent === 'codex' && ++codexCalls === 10 ? { status: 1, error: '429 rate limit reached' } : null) });
    assert.equal(await tool.capture({ root: p.dir, base: TAG, runner: first.runner, resolve, say: quiet }), 5);
    const before = runJson(p.baseline);
    const recorded = callRows(p.baseline).length;
    assert.ok(recorded > 0);

    // Without --resume the S5 refusal stays: exit 3, no agent call, no file changed.
    const snap = snapshot(p.baseline);
    const refused = fakeRunner();
    assert.equal(await tool.capture({ root: p.dir, runner: refused.runner, resolve, say: quiet }), 3);
    assert.equal(refused.calls.length, 0);
    assert.deepEqual(snapshot(p.baseline), snap);

    // A new commit after the stop: resume keeps the first run's commit and records the new one as a resume.
    writeFileSync(join(p.dir, 'tools', 'resume-marker.txt'), 'x\n');
    assert.equal(git(p.dir, ['add', '-A']).status, 0);
    assert.equal(git(p.dir, ['commit', '-q', '-m', 'harness change']).status, 0);

    const second = fakeRunner();
    assert.equal(await tool.capture({ root: p.dir, resume: true, runner: second.runner, resolve, say: quiet }), 0);
    const total = callRows(p.baseline).length;
    assert.equal(second.calls.length, total - recorded, 'resume ran only the missing calls');
    const keys = callRows(p.baseline).map((r) => r.split('\t').slice(0, 5).join('\t'));
    assert.equal(new Set(keys).size, keys.length, 'no call recorded twice');
    const after = runJson(p.baseline);
    assert.equal(after.status, 'complete');
    assert.equal(after.base, before.base);
    assert.equal(after.commit, before.commit);
    assert.equal(after.resumed.length, 1);
    assert.notEqual(after.resumed[0].commit, before.commit);
  } finally {
    p.cleanup();
  }
});

test('M-001-S9-osdr resume runs again a call recorded with the model unknown', async () => {
  const p = packRepo();
  try {
    const fake = fakeRunner();
    assert.equal(await tool.capture({ root: p.dir, runner: fake.runner, resolve, say: quiet }), 0);
    const file = filesUnder(p.baseline).find((f) => f.includes(`${sep}codex${sep}`) && basename(f) === 'calls.tsv');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[1] = lines[1].replace(MODEL.codex, 'unknown');
    writeFileSync(file, lines.join('\n'));
    rmSync(join(p.baseline, 'manifest.json'));

    const again = fakeRunner();
    assert.equal(await tool.capture({ root: p.dir, resume: true, runner: again.runner, resolve, say: quiet }), 0);
    assert.equal(again.calls.length, 1);
    assert.equal(again.calls[0].agent, 'codex');
    assert.ok(!callRows(p.baseline).some((r) => r.split('\t')[5] === 'unknown'), 'no row keeps the model unknown');
  } finally {
    p.cleanup();
  }
});

test('M-001-S9-osdr codex model id is read from the stderr header of a real codex process', { skip: process.platform === 'win32' }, () => {
  assert.equal(tool.codexHeaderModel('OpenAI Codex v0\n--------\nmodel: gpt-fake-9\nprovider: openai\n'), 'gpt-fake-9');
  assert.equal(tool.codexHeaderModel('no header'), null);
  const dir = mkdtempSync(join(tmpdir(), 'qb-codex-'));
  try {
    const bin = join(dir, 'codex');
    const events = [{ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'ok' } }, { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }];
    writeFileSync(
      bin,
      [
        `#!${process.execPath}`,
        `const json = process.argv.includes('--json');`,
        `process.stdin.resume(); process.stdin.on('end', () => {`,
        `  if (json) { process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join('\n'))} + '\\n'); return; }`,
        `  process.stderr.write('OpenAI Codex v0\\n--------\\nmodel: gpt-fake-9\\nreasoning effort: medium\\n'); process.stdout.write('ok\\n');`,
        `});`,
      ].join('\n'),
    );
    chmodSync(bin, 0o755);
    const res = tool.defaultRunner({ agent: 'codex', agentPath: bin, prompt: 'hello', timeoutMs: 20000 });
    assert.equal(res.error, null);
    assert.equal(res.model, 'gpt-fake-9');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-001-S19-osdr codex parked after two failed calls in a row while claude, noise, freeze and verify finish', async () => {
  const p = packRepo();
  try {
    const fake = fakeRunner({ fail: (call) => (call.agent === 'codex' ? timedOut() : null) });
    const lines = [];
    const code = await tool.capture({ root: p.dir, runner: fake.runner, resolve, say: (...a) => lines.push(a.join(' ')) });
    assert.equal(code, 5);
    assert.equal(fake.calls.filter((c) => c.agent === 'codex').length, 4, 'two calls, each retried once, then the arm stops');
    assert.match(lines.join('\n'), /blocked-on-user codex arm parked/);
    const run = runJson(p.baseline);
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.parked, ['codex']);
    assert.ok(run.blocked.some((b) => /^codex: /.test(b)), run.blocked.join('\n'));

    const planned = tool.planCalls({ root: p.dir }).length + tool.planMailCalls({ root: p.dir }).length;
    const claudeRows = callRows(p.baseline).filter((r) => r.split('\t')[1] === 'claude');
    assert.equal(claudeRows.length, planned * tool.ARMS.length, 'both Claude arms complete');

    assert.equal(await tool.noise({ root: p.dir, runner: fake.runner, resolve, say: quiet, seed: 'park' }), 0);
    const noise = JSON.parse(readFileSync(join(p.baseline, 'noise.json'), 'utf8'));
    assert.ok(noise.verdicts.length > 0 && noise.verdicts.every((v) => v.agent === 'claude'));
    assert.equal(await tool.freeze({ root: p.dir, say: quiet }), 0);
    assert.equal(await tool.verify({ root: p.dir, say: quiet }), 0);
  } finally {
    p.cleanup();
  }
});
